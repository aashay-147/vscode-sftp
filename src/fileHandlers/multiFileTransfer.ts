// Aggregated staging for multi-file selections (Features 2+3, U3.6): explorer/
// Remote-Explorer multi-select and Upload Changed Files. Groups the selection
// by FileService and, per service, classifies every file up front so ONE
// counts modal covers the whole batch (flags are per-profile, so a merged
// cross-service modal would misreport — one modal per service, sequential).
// Selected folders are not aggregated: each runs its own staged flow,
// sequentially, through the ordinary folder handlers.

import { Uri } from 'vscode';
import {
  upath,
  FileStats,
  FileSystem,
  FileService,
  FileType,
  TransferDirection,
} from '../core';
import { reportError } from '../helper';
import { showTransferProgress } from '../host';
import {
  operationEnded,
  operationProgressed,
  operationStarted,
  progressMessage,
  TransferOperation,
} from '../ui/transferControls';
import { handleCtxFromUri, FileHandlerContext } from './createFileHandler';
import { classifyPair, deriveCompareMtime, CompareEntry, CompareStatus } from './compare';
import { uploadFile, downloadFile } from './transfer';
import { StagePlan } from './transfer/stage';
import { confirmStagePlan } from './transfer/stagedTransfer';
import { FileHandleOption } from './option';

async function lstatOrNull(fileSystem: FileSystem, fsPath: string): Promise<FileStats | null> {
  try {
    return await fileSystem.lstat(fsPath);
  } catch (error) {
    return null;
  }
}

// Determinate progress over a concurrent per-file handler fan-out (Feature 5).
// Each job is a full single-file handler call with its own one-task scheduler,
// so unlike a folder transfer there is no shared queue: Cancel falls back to
// the service-wide stop, and Pause has nothing queued to hold — an accepted
// limitation of the multi-select path.
async function runBatchWithProgress(
  title: string,
  fileService: FileService,
  jobs: Array<() => Promise<unknown>>
): Promise<void> {
  if (jobs.length <= 1) {
    await Promise.all(jobs.map(job => job()));
    return;
  }

  const op: TransferOperation = { done: 0, total: jobs.length };
  operationStarted(op);
  try {
    await showTransferProgress(`${title} (${jobs.length} files)`, (report, onCancel) => {
      op.report = report;
      onCancel(() => fileService.cancelTransferTasks());
      return Promise.all(
        jobs.map(job =>
          job().then(() => {
            op.done += 1;
            report({ increment: 100 / op.total, message: progressMessage(op) });
            operationProgressed();
          })
        )
      );
    });
  } finally {
    operationEnded(op);
  }
}

interface ClassifiedTarget {
  ctx: FileHandlerContext;
  // absolute source-side path (local for upload, remote for download)
  srcFsPath: string;
  entry: CompareEntry | null;
  bothPresent: boolean;
}

export async function transferSelectedFiles(
  uris: Uri[],
  direction: TransferDirection,
  baseOption: Partial<FileHandleOption> = {}
): Promise<void> {
  const fromLocal = direction === TransferDirection.LOCAL_TO_REMOTE;
  const handler = fromLocal ? uploadFile : downloadFile;

  // group by service; files outside any config are reported and skipped, not
  // fatal to the batch (same stance as compareFiles)
  const byService = new Map<FileService, FileHandlerContext[]>();
  for (const uri of uris) {
    let ctx: FileHandlerContext;
    try {
      ctx = handleCtxFromUri(uri);
    } catch (error) {
      reportError(error);
      continue;
    }
    const list = byService.get(ctx.fileService) || [];
    list.push(ctx);
    byService.set(ctx.fileService, list);
  }

  // one service at a time so modals appear one at a time
  for (const [fileService, ctxs] of byService) {
    const config = ctxs[0].config;
    const confirmOverwrite = Boolean(config.confirmOverwrite);
    const skipUnmodified = Boolean(config.skipUnmodified);

    if (!confirmOverwrite && !skipUnmodified) {
      // flags off: today's plain concurrent per-uri fan-out, byte-for-byte —
      // now with a batch counter over the settled handler calls
      await runBatchWithProgress(
        `SFTP: ${fromLocal ? 'Uploading' : 'Downloading'} selected files`,
        fileService,
        ctxs.map(ctx => () => handler(ctx, baseOption).catch(error => reportError(error)))
      );
      continue;
    }

    const remoteFs = await fileService.getRemoteFileSystem(config);
    const localFs = fileService.getLocalFileSystem();
    const compareMtime = deriveCompareMtime(config);
    // honor the same ignore the transfer itself would apply (call-site
    // `ignore: null` wins over config, like everywhere else)
    const ignore = 'ignore' in baseOption ? baseOption.ignore : config.ignore;

    const folders: FileHandlerContext[] = [];
    const files: ClassifiedTarget[] = [];
    await Promise.all(
      ctxs.map(async ctx => {
        const { localFsPath, remoteFsPath } = ctx.target;
        if (ignore && ignore(localFsPath)) {
          return;
        }
        const [localStat, remoteStat] = await Promise.all([
          lstatOrNull(localFs, localFsPath),
          lstatOrNull(remoteFs, remoteFsPath),
        ]);
        const srcStat = fromLocal ? localStat : remoteStat;
        if (srcStat && srcStat.type === FileType.Directory) {
          folders.push(ctx);
          return;
        }
        const relPath = upath.relative(
          upath.normalize(config.remotePath),
          upath.normalize(remoteFsPath)
        );
        files.push({
          ctx,
          srcFsPath: fromLocal ? localFsPath : remoteFsPath,
          entry: classifyPair(
            localStat,
            remoteStat,
            { relPath, localFsPath, remoteFsPath },
            compareMtime
          ),
          bothPresent: Boolean(localStat && remoteStat),
        });
      })
    );

    if (files.length > 0) {
      await transferClassifiedFiles(files, {
        direction,
        confirmOverwrite,
        skipUnmodified,
        compareMtime,
        baseOption,
        fileService,
        config,
      });
    }

    // each selected folder runs its own staged flow (walk + modal via the
    // ordinary handler), sequentially — no merged cross-folder plan
    for (const ctx of folders) {
      try {
        await handler(ctx, baseOption);
      } catch (error) {
        reportError(error);
      }
    }
  }
}

async function transferClassifiedFiles(
  files: ClassifiedTarget[],
  args: {
    direction: TransferDirection;
    confirmOverwrite: boolean;
    skipUnmodified: boolean;
    compareMtime: boolean;
    baseOption: Partial<FileHandleOption>;
    fileService: FileService;
    config: FileHandlerContext['config'];
  }
): Promise<void> {
  const { direction, confirmOverwrite, skipUnmodified, compareMtime, baseOption } = args;
  const fromLocal = direction === TransferDirection.LOCAL_TO_REMOTE;
  const createStatus = fromLocal ? CompareStatus.NewLocal : CompareStatus.NewRemote;
  const destOnlyStatus = fromLocal ? CompareStatus.NewRemote : CompareStatus.NewLocal;

  const entries: CompareEntry[] = [];
  const identical: string[] = [];
  const counts = { create: 0, overwriteModified: 0, overwriteTimeDiff: 0, identical: 0 };
  for (const file of files) {
    if (!file.entry) {
      if (file.bothPresent) {
        identical.push(file.srcFsPath);
      } else {
        // missing on both sides — let the transfer surface the real error
        counts.create += 1;
      }
      continue;
    }
    entries.push(file.entry);
    if (file.entry.status === createStatus) {
      counts.create += 1;
    } else if (file.entry.status === CompareStatus.Modified) {
      counts.overwriteModified += 1;
    } else if (file.entry.status === CompareStatus.TimeDiff) {
      counts.overwriteTimeDiff += 1;
    }
    // destOnlyStatus entries appear in Review but never transfer
  }
  counts.identical = identical.length;
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const plan: StagePlan = {
    result: {
      localRoot: args.fileService.baseDir,
      remoteRoot: args.config.remotePath,
      serviceName: args.fileService.name,
      // files origin so a later Refresh re-checks exactly this selection
      // instead of widening into a folder walk
      origin: { kind: 'files', uris: files.map(f => f.ctx.target.localUri.toString()) },
      entries,
    },
    identical,
    counts,
  };

  const decision = await confirmStagePlan({
    plan,
    direction,
    confirmOverwrite,
    skipUnmodified,
    compareMtime,
    sourceLabel: `${files.length} selected file${files.length > 1 ? 's' : ''}`,
    destinationLabel: fromLocal
      ? `${args.config.host}:${args.config.remotePath}`
      : args.fileService.baseDir,
    multiProfileFlow: false,
  });
  if (decision.action !== 'proceed') {
    return;
  }

  const skipSet = decision.skipSet;
  const handler = fromLocal ? uploadFile : downloadFile;
  const transferSet = files.filter(file => {
    if (skipSet && skipSet.has(file.srcFsPath)) {
      return false;
    }
    // destination-only files are never part of the transfer set
    return !(file.entry && file.entry.status === destOnlyStatus);
  });
  await runBatchWithProgress(
    `SFTP: ${fromLocal ? 'Uploading' : 'Downloading'} selected files`,
    args.fileService,
    transferSet.map(file => () =>
      handler(file.ctx, {
        ...baseOption,
        // the batch modal (or fast path) already covered this transfer
        confirmOverwrite: false,
        skipUnmodified: false,
      }).catch(error => reportError(error))
    )
  );
}

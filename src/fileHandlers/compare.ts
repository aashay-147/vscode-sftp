import * as path from 'path';
import { Uri } from 'vscode';
import app from '../app';
import { upath, FileSystem, FileEntry, FileStats, FileService, FileType } from '../core';
import { reportError } from '../helper';
import { showCancellableProgress } from '../host';
import { FileHandleOption } from './option';
import createFileHandler, { handleCtxFromUri, FileHandlerContext } from './createFileHandler';

export enum CompareStatus {
  NewLocal = 'newLocal',
  NewRemote = 'newRemote',
  Modified = 'modified',
  // same size, different mtime — optimistically treated as timestamp-only.
  // an in-place same-length content edit would also land here; the diff action
  // stays available on these entries so the user can verify.
  TimeDiff = 'timeDiff',
}

export interface CompareEntry {
  // posix-style path relative to the compared roots
  relPath: string;
  localFsPath: string;
  remoteFsPath: string;
  status: CompareStatus;
}

// How the current result was produced, so Refresh re-runs the SAME scope
// instead of silently widening a file selection into a full folder walk.
export type CompareOrigin =
  | { kind: 'folder'; root: string }
  | { kind: 'files'; uris: string[] };

export interface CompareResult {
  localRoot: string;
  remoteRoot: string;
  serviceName?: string;
  origin: CompareOrigin;
  entries: CompareEntry[];
}

// Classify a file present on both sides. Same basis as sync's isFileModified
// (mtime at second granularity or size), but split so a pure timestamp drift
// is distinguishable from a real content change:
//   - size differs        => Modified   (content definitely changed)
//   - size same, mtime !=  => TimeDiff   (optimistically timestamp-only)
//   - otherwise            => null       (unchanged)
// remote mtimes arrive already offset-adjusted from the remote fs layer,
// so remoteTimeOffsetInHours must not be re-applied here.
//
// compareMtime is false for FTP: LIST timestamps are unreliable — minute
// granularity, and the `ftp` lib parses the server's wall-clock with a
// process-local-timezone Date ctor, so byte-identical files routinely differ
// by a whole-hour TZ skew and/or dropped sub-minute seconds. Rather than
// surface that noise as TimeDiff, FTP classifies on size ALONE; same-size
// files are treated as unchanged. (A same-length in-place edit is therefore
// not detected over FTP — the price of not trusting FTP mtimes. Trigger a
// content diff explicitly to confirm such a file.)
export function diffStatus(a: FileStats, b: FileStats, compareMtime: boolean): CompareStatus | null {
  if (a.size !== b.size) {
    return CompareStatus.Modified;
  }
  if (compareMtime && Math.floor(a.mtime / 1000) !== Math.floor(b.mtime / 1000)) {
    return CompareStatus.TimeDiff;
  }
  return null;
}

// FTP LIST mtimes can't be trusted (see diffStatus) — compare on size only.
export function deriveCompareMtime(config: { protocol?: string }): boolean {
  return config.protocol !== 'ftp';
}

// Path/rel identity of one file across both sides, resolved from the config
// context so it slots into the same groups/nesting as the folder walk.
interface CompareLocation {
  relPath: string;
  localFsPath: string;
  remoteFsPath: string;
}

// Classify one file from stats already known on each side (null == missing on
// that side). Single source of truth for the New/Modified/TimeDiff/unchanged
// decision, shared by the folder walk (which already holds both stats) and the
// selected-file path (which lstats on demand) so the two can't drift.
export function classifyPair(
  local: FileStats | null,
  remote: FileStats | null,
  location: CompareLocation,
  compareMtime: boolean
): CompareEntry | null {
  if (local && !remote) {
    return { ...location, status: CompareStatus.NewLocal };
  }
  if (!local && remote) {
    return { ...location, status: CompareStatus.NewRemote };
  }
  if (!local || !remote) {
    return null;
  }
  const status = diffStatus(local, remote, compareMtime);
  return status ? { ...location, status } : null;
}

async function lstatOrNull(fileSystem: FileSystem, fsPath: string): Promise<FileStats | null> {
  try {
    return await fileSystem.lstat(fsPath);
  } catch (error) {
    // absent on this side — the other side (if present) is "new" here
    return null;
  }
}

// lstat both sides (swallowing not-found) then classify. Used for an explicitly
// selected file, where there's no pre-walked directory listing to draw from.
export async function classifyFile(
  localFs: FileSystem,
  remoteFs: FileSystem,
  location: CompareLocation,
  compareMtime: boolean
): Promise<CompareEntry | null> {
  const [local, remote] = await Promise.all([
    lstatOrNull(localFs, location.localFsPath),
    lstatOrNull(remoteFs, location.remoteFsPath),
  ]);
  return classifyPair(local, remote, location, compareMtime);
}

// Bounds concurrent list() calls during a walk (Feature 4). The recursive walk
// otherwise fires one list() per directory all at once, which floods a pooled
// connection set and starves transfers sharing it. Held only around the
// directory read itself — released before recursing — so deep trees can't
// deadlock on the limit.
export class WalkLimit {
  private available: number;
  private waiting: Array<() => void> = [];

  constructor(limit: number) {
    this.available = Math.max(1, limit || 1);
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>(resolve => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.available += 1;
    }
  }
}

// Optional walk instrumentation for long-running collects (staging): a
// cancellation probe checked once per directory level, a per-file tick
// for indeterminate progress counters, and a bound on concurrent list() calls.
export interface WalkControl {
  isCancelled(): boolean;
  onFile?(): void;
  listLimit?: WalkLimit;
}

export async function collectFiles(
  fileSystem: FileSystem,
  root: string,
  dir: string,
  ignore: FileHandleOption['ignore'],
  out: Map<string, FileEntry>,
  control?: WalkControl
): Promise<void> {
  if (control && control.isCancelled()) {
    return;
  }

  let fileEntries: FileEntry[];
  const limit = control && control.listLimit;
  if (limit) {
    await limit.acquire();
  }
  try {
    fileEntries = await fileSystem.list(dir);
  } catch (error) {
    // the folder may not exist on this side — every file on the other side is "new"
    return;
  } finally {
    if (limit) {
      limit.release();
    }
  }

  await Promise.all(
    fileEntries.map(async fileEntry => {
      if (ignore && ignore(fileEntry.fspath)) {
        return;
      }

      switch (fileEntry.type) {
        case FileType.Directory:
          await collectFiles(fileSystem, root, fileEntry.fspath, ignore, out, control);
          break;
        case FileType.File:
        case FileType.SymbolicLink:
          if (control && control.onFile) {
            control.onFile();
          }
          out.set(
            upath.relative(upath.normalize(root), upath.normalize(fileEntry.fspath)),
            fileEntry
          );
          break;
        default:
        // do not process
      }
    })
  );
}

export const compareFolders = createFileHandler<FileHandleOption>({
  name: 'compare folders',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath, remoteFsPath } = this.target;

    const compareMtime = deriveCompareMtime(this.config);

    const localFiles = new Map<string, FileEntry>();
    const remoteFiles = new Map<string, FileEntry>();
    // Cancellable, indeterminate walk progress (Feature 5): the total isn't
    // known without a separate counting pass, so this stays a live counter
    // until Feature 4 routes the walk through the transfer scheduler.
    const cancelled = await showCancellableProgress(
      `SFTP: Comparing '${path.basename(localFsPath)}'`,
      async (report, isCancelled) => {
        let seen = 0;
        const control = {
          isCancelled,
          onFile() {
            seen += 1;
            report(`${seen} files checked`);
          },
        };
        // each side gets its own limit — the local walk must not queue behind
        // slow remote directory reads (Feature 4)
        await Promise.all([
          collectFiles(localFs, localFsPath, localFsPath, option.ignore, localFiles, {
            ...control,
            listLimit: new WalkLimit(this.config.concurrency),
          }),
          collectFiles(remoteFs, remoteFsPath, remoteFsPath, option.ignore, remoteFiles, {
            ...control,
            listLimit: new WalkLimit(this.config.concurrency),
          }),
        ]);
        return isCancelled();
      }
    );
    if (cancelled) {
      // partial walk — keep whatever result is currently shown
      return;
    }

    const entries: CompareEntry[] = [];
    localFiles.forEach((localEntry, relPath) => {
      const remoteEntry = remoteFiles.get(relPath);
      if (remoteEntry) {
        remoteFiles.delete(relPath);
      }
      const entry = classifyPair(localEntry, remoteEntry || null, {
        relPath,
        localFsPath: localEntry.fspath,
        remoteFsPath: remoteEntry ? remoteEntry.fspath : upath.join(remoteFsPath, relPath),
      }, compareMtime);
      if (entry) {
        entries.push(entry);
      }
    });
    remoteFiles.forEach((remoteEntry, relPath) => {
      const entry = classifyPair(null, remoteEntry, {
        relPath,
        localFsPath: path.join(localFsPath, relPath),
        remoteFsPath: remoteEntry.fspath,
      }, compareMtime);
      if (entry) {
        entries.push(entry);
      }
    });
    entries.sort((a, b) => a.relPath.localeCompare(b.relPath));

    if (app.compareExplorer) {
      app.compareExplorer.setResult({
        localRoot: localFsPath,
        remoteRoot: remoteFsPath,
        serviceName: this.fileService.name,
        origin: { kind: 'folder', root: localFsPath },
        entries,
      });
    }
  },
  transformOption() {
    return {
      ignore: this.config.ignore,
    };
  },
});

// Classify an explicit set of selected files (not a folder walk) and load just
// those into the compare view. Aggregates ALL uris into ONE setResult — a
// createFileCommand's per-uri fan-out would clobber every file but the last.
// Groups by fileService so a multi-root/multi-profile selection still works;
// files outside any config are reported and skipped, not fatal to the batch.
export async function compareFiles(uris: Uri[]): Promise<void> {
  const byService = new Map<FileService, FileHandlerContext[]>();
  for (const uri of uris) {
    let ctx: FileHandlerContext;
    try {
      ctx = handleCtxFromUri(uri);
    } catch (error) {
      // selected file isn't under any configured context — skip it
      reportError(error);
      continue;
    }
    const list = byService.get(ctx.fileService) || [];
    list.push(ctx);
    byService.set(ctx.fileService, list);
  }

  if (byService.size === 0) {
    return;
  }

  const entries: CompareEntry[] = [];
  // roots/header come from the first service; entries carry absolute paths, so a
  // cross-service selection still renders (the header names the first service).
  let localRoot: string | undefined;
  let remoteRoot: string | undefined;
  let serviceName: string | undefined;

  for (const [fileService, ctxs] of byService) {
    const config = fileService.getConfig();
    const remoteFs = await fileService.getRemoteFileSystem(config);
    const localFs = fileService.getLocalFileSystem();
    const compareMtime = deriveCompareMtime(config);

    if (localRoot === undefined) {
      localRoot = fileService.baseDir;
      remoteRoot = config.remotePath;
      serviceName = fileService.name;
    }

    await Promise.all(
      ctxs.map(async ctx => {
        const { localFsPath, remoteFsPath } = ctx.target;
        const relPath = upath.relative(
          upath.normalize(config.remotePath),
          upath.normalize(remoteFsPath)
        );
        try {
          const entry = await classifyFile(
            localFs,
            remoteFs,
            { relPath, localFsPath, remoteFsPath },
            compareMtime
          );
          if (entry) {
            entries.push(entry);
          }
        } catch (error) {
          reportError(error);
        }
      })
    );
  }

  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));

  if (app.compareExplorer) {
    app.compareExplorer.setResult({
      localRoot: localRoot!,
      remoteRoot: remoteRoot!,
      serviceName,
      origin: { kind: 'files', uris: uris.map(uri => uri.toString()) },
      entries,
    });
  }
}

export interface MatchTimestampOption {
  // which side is the source of truth; the other side is stamped to match it.
  source: 'local' | 'remote';
}

// Copy the modification time of one side onto the other WITHOUT transferring
// content. Resolves timestamp-only (TimeDiff) rows so future compares stop
// flagging them. futimes takes seconds and each fs backend applies the remote
// time offset itself (sftp: fsetstat, ftp: MFMT, local: fse.futimes); MFMT-less
// FTP servers no-op silently, so the row may persist there.
export const matchTimestamp = createFileHandler<MatchTimestampOption>({
  name: 'match timestamp',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath, remoteFsPath } = this.target;

    const fromRemote = option.source === 'remote';
    const srcFs = fromRemote ? remoteFs : localFs;
    const srcPath = fromRemote ? remoteFsPath : localFsPath;
    const targetFs = fromRemote ? localFs : remoteFs;
    const targetPath = fromRemote ? localFsPath : remoteFsPath;

    const srcStat = await srcFs.lstat(srcPath);
    const atimeInSeconds = Math.floor(srcStat.atime / 1000);
    const mtimeInSeconds = Math.floor(srcStat.mtime / 1000);

    // 'r+' opens the existing file for writing without truncating it; ftp's
    // open/close are no-ops that just carry the path through to futimes/MFMT.
    const fd = await targetFs.open(targetPath, 'r+');
    try {
      await targetFs.futimes(fd, atimeInSeconds, mtimeInSeconds);
    } finally {
      await targetFs.close(fd);
    }
  },
  transformOption() {
    return { source: 'remote' };
  },
});

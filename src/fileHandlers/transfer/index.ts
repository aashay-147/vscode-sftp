import * as path from 'path';
import { FileType } from '../../core';
import { refreshRemoteExplorer } from '../shared';
import createFileHandler, { FileHandlerContext } from '../createFileHandler';
import { transfer, sync, SyncOption, TransferDirection } from './transfer';
import { DownloadOption, resolveEffectiveTarget } from './downloadTarget';
import { runTransferScheduler } from './progress';
import {
  StagedTransferCancelledError,
  lstatTypeOrNull,
  stageAndConfirmFolderTransfer,
} from './stagedTransfer';
import { refreshUploadMenuContext } from '../../modules/uploadMenuContext';

function createTransferHandle(direction: TransferDirection) {
  return async function handle(this: FileHandlerContext, option) {
    // Feature 9: remap through the local mirror BEFORE anything reads the
    // target - the staged pre-flight, transferConfig, progress and afterHandle
    // all consume this.target, so one reassignment keeps them consistent.
    // Structural no-op unless the call site flags useLocalDownloadPath and
    // localDownloadPath is configured.
    this.target = resolveEffectiveTarget(this, option, direction);
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath, remoteFsPath } = this.target;

    // Staged flow (Features 2+3). The flag check MUST come before any stat so
    // the flags-off default stays zero-extra-round-trip on both sides; the
    // flags-on duplicate source lstat (transfer() repeats it below) is
    // accepted. Files fall through to the per-file gate in transferWithType.
    if (option.confirmOverwrite || option.skipUnmodified) {
      const fromRemote = direction === TransferDirection.REMOTE_TO_LOCAL;
      const srcType = await lstatTypeOrNull(
        fromRemote ? remoteFs : localFs,
        fromRemote ? remoteFsPath : localFsPath
      );
      if (srcType === FileType.Directory) {
        const decision = await stageAndConfirmFolderTransfer(
          this,
          option,
          direction,
          localFs,
          remoteFs
        );
        if (decision.action === 'cancelRemaining') {
          throw new StagedTransferCancelledError();
        }
        if (decision.action !== 'proceed') {
          return;
        }
        option._overwriteConfirmed = true;
        if (decision.skipSet) {
          option._skipSet = decision.skipSet;
        }
      }
    }

    const scheduler = this.fileService.createTransferScheduler(this.config.concurrency);
    let transferConfig;

    if (direction === TransferDirection.REMOTE_TO_LOCAL) {
      transferConfig = {
        srcFsPath: remoteFsPath,
        srcFs: remoteFs,
        targetFsPath: localFsPath,
        targetFs: localFs,
        transferOption: option,
        transferDirection: TransferDirection.REMOTE_TO_LOCAL,
      };
    } else {
      transferConfig = {
        srcFsPath: localFsPath,
        srcFs: localFs,
        targetFsPath: remoteFsPath,
        targetFs: remoteFs,
        transferOption: option,
        filePerm: this.config.filePerm,
        dirPerm: this.config.dirPerm,
        transferDirection: TransferDirection.LOCAL_TO_REMOTE,
      };
    }
    // todo: abort at here. we should stop collect task
    await transfer(transferConfig, t => scheduler.add(t));
    if (option._noProgress) {
      await scheduler.run();
    } else {
      const verb =
        direction === TransferDirection.LOCAL_TO_REMOTE ? 'Uploading' : 'Downloading';
      const sourceName = path.basename(
        direction === TransferDirection.LOCAL_TO_REMOTE ? localFsPath : remoteFsPath
      );
      await runTransferScheduler(scheduler, `SFTP: ${verb} '${sourceName}'`);
    }
  };
}

const uploadHandle = createTransferHandle(TransferDirection.LOCAL_TO_REMOTE);
const downloadHandle = createTransferHandle(TransferDirection.REMOTE_TO_LOCAL);

export const sync2Remote = createFileHandler<SyncOption>({
  name: 'sync local ➞ remote',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath, remoteFsPath } = this.target;
    const scheduler = this.fileService.createTransferScheduler(this.config.concurrency);
    // Attach filePerm and dirPerm to transferOption
    option.filePerm = this.config.filePerm;
    option.dirPerm = this.config.dirPerm;
    await sync(
      {
        srcFsPath: localFsPath,
        srcFs: localFs,
        targetFsPath: remoteFsPath,
        targetFs: remoteFs,
        transferOption: option,
        transferDirection: TransferDirection.LOCAL_TO_REMOTE,
      },
      t => scheduler.add(t)
    );
    await runTransferScheduler(
      scheduler,
      `SFTP: Syncing '${path.basename(localFsPath)}' to remote`
    );
  },
  transformOption() {
    const config = this.config;
    const syncOption = config.syncOption || {};
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.filePerm && !config.dirPerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
      delete: syncOption.delete,
      skipCreate: syncOption.skipCreate,
      ignoreExisting: syncOption.ignoreExisting,
      update: syncOption.update,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, true);
  },
});

export const sync2Local = createFileHandler<SyncOption>({
  name: 'sync remote ➞ local',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath, remoteFsPath } = this.target;
    const scheduler = this.fileService.createTransferScheduler(this.config.concurrency);
    await sync(
      {
        srcFsPath: remoteFsPath,
        srcFs: remoteFs,
        targetFsPath: localFsPath,
        targetFs: localFs,
        transferOption: option,
        transferDirection: TransferDirection.REMOTE_TO_LOCAL,
      },
      t => scheduler.add(t)
    );
    await runTransferScheduler(
      scheduler,
      `SFTP: Syncing '${path.basename(localFsPath)}' from remote`
    );
  },
  transformOption() {
    const config = this.config;
    const syncOption = config.syncOption || {};
    return {
      perserveTargetMode: false,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
      delete: syncOption.delete,
      skipCreate: syncOption.skipCreate,
      ignoreExisting: syncOption.ignoreExisting,
      update: syncOption.update,
    };
  },
});

export const upload = createFileHandler<DownloadOption>({
  name: 'upload',
  handle: uploadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.filePerm && !config.dirPerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
      confirmOverwrite: config.confirmOverwrite,
      skipUnmodified: config.skipUnmodified,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, this.fileService);
  },
});

export const uploadFile = createFileHandler<DownloadOption>({
  name: 'upload file',
  handle: uploadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.filePerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
      confirmOverwrite: config.confirmOverwrite,
      skipUnmodified: config.skipUnmodified,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, false);
  },
});

export const uploadFolder = createFileHandler<DownloadOption>({
  name: 'upload folder',
  handle: uploadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: config.protocol === 'sftp' && !config.dirPerm,
      useTempFile: config.useTempFile,
      openSsh: config.openSsh,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
      confirmOverwrite: config.confirmOverwrite,
      skipUnmodified: config.skipUnmodified,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, true);
  },
});

export const download = createFileHandler<DownloadOption>({
  name: 'download',
  handle: downloadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: false,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
      confirmOverwrite: config.confirmOverwrite,
      skipUnmodified: config.skipUnmodified,
    };
  },
  afterHandle() {
    // downloads can create new mirror directories - keep the menu-gating
    // allow-set current (debounced no-op unless the feature is opted in)
    refreshUploadMenuContext();
  },
});

export const downloadFile = createFileHandler<DownloadOption>({
  name: 'download file',
  handle: downloadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: false,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
      confirmOverwrite: config.confirmOverwrite,
      skipUnmodified: config.skipUnmodified,
    };
  },
  afterHandle() {
    refreshUploadMenuContext();
  },
});

export const downloadFolder = createFileHandler<DownloadOption>({
  name: 'download folder',
  handle: downloadHandle,
  transformOption() {
    const config = this.config;
    return {
      perserveTargetMode: false,
      // remoteTimeOffsetInHours: config.remoteTimeOffsetInHours,
      ignore: config.ignore,
      confirmOverwrite: config.confirmOverwrite,
      skipUnmodified: config.skipUnmodified,
    };
  },
  afterHandle() {
    refreshUploadMenuContext();
  },
});

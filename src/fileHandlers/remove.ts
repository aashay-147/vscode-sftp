import { refreshRemoteExplorer } from './shared';
import { fileOperations, FileType } from '../core';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from './option';
import logger from '../logger';

export const removeRemote = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'removeRemote',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;
    const stat = await remoteFs.lstat(remoteFsPath);
    let promise;
    switch (stat.type) {
      case FileType.Directory:
        if (option.skipDir) {
          return;
        }

        promise = fileOperations.removeDir(remoteFsPath, remoteFs, {});
        break;
      case FileType.File:
      case FileType.SymbolicLink:
        promise = fileOperations.removeFile(remoteFsPath, remoteFs, {});
        break;
      default:
        logger.warn(`Unsupported file type (type = ${stat.type}). File ${remoteFsPath}`);
    }
    await promise;
  },
  transformOption() {
    const config = this.config;
    return {
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, false);
  },
});

// Local-side counterpart of removeRemote. Used by the folder-compare view to
// mirror-delete New-Local files (files that exist locally but not on the
// remote). Callers must confirm first - this permanently removes local files.
export const removeLocal = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'removeLocal',
  async handle(option) {
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath } = this.target;
    const stat = await localFs.lstat(localFsPath);
    let promise;
    switch (stat.type) {
      case FileType.Directory:
        if (option.skipDir) {
          return;
        }

        promise = fileOperations.removeDir(localFsPath, localFs, {});
        break;
      case FileType.File:
      case FileType.SymbolicLink:
        promise = fileOperations.removeFile(localFsPath, localFs, {});
        break;
      default:
        logger.warn(`Unsupported file type (type = ${stat.type}). File ${localFsPath}`);
    }
    await promise;
  },
  transformOption() {
    const config = this.config;
    return {
      ignore: config.ignore,
    };
  },
});

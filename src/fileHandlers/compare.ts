import * as path from 'path';
import app from '../app';
import { upath, FileSystem, FileEntry, FileType } from '../core';
import { FileHandleOption } from './option';
import createFileHandler from './createFileHandler';

export enum CompareStatus {
  NewLocal = 'newLocal',
  NewRemote = 'newRemote',
  Modified = 'modified',
}

export interface CompareEntry {
  // posix-style path relative to the compared roots
  relPath: string;
  localFsPath: string;
  remoteFsPath: string;
  status: CompareStatus;
}

export interface CompareResult {
  localRoot: string;
  remoteRoot: string;
  serviceName?: string;
  entries: CompareEntry[];
}

// same basis as sync's isFileModified: mtime at second granularity or size.
// remote mtimes arrive already offset-adjusted from the remote fs layer,
// so remoteTimeOffsetInHours must not be re-applied here.
function isFileModified(a: FileEntry, b: FileEntry): boolean {
  return Math.floor(a.mtime / 1000) !== Math.floor(b.mtime / 1000) || a.size !== b.size;
}

async function collectFiles(
  fileSystem: FileSystem,
  root: string,
  dir: string,
  ignore: FileHandleOption['ignore'],
  out: Map<string, FileEntry>
): Promise<void> {
  let fileEntries: FileEntry[];
  try {
    fileEntries = await fileSystem.list(dir);
  } catch (error) {
    // the folder may not exist on this side — every file on the other side is "new"
    return;
  }

  await Promise.all(
    fileEntries.map(async fileEntry => {
      if (ignore && ignore(fileEntry.fspath)) {
        return;
      }

      switch (fileEntry.type) {
        case FileType.Directory:
          await collectFiles(fileSystem, root, fileEntry.fspath, ignore, out);
          break;
        case FileType.File:
        case FileType.SymbolicLink:
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

    const localFiles = new Map<string, FileEntry>();
    const remoteFiles = new Map<string, FileEntry>();
    await Promise.all([
      collectFiles(localFs, localFsPath, localFsPath, option.ignore, localFiles),
      collectFiles(remoteFs, remoteFsPath, remoteFsPath, option.ignore, remoteFiles),
    ]);

    const entries: CompareEntry[] = [];
    localFiles.forEach((localEntry, relPath) => {
      const remoteEntry = remoteFiles.get(relPath);
      if (!remoteEntry) {
        entries.push({
          relPath,
          localFsPath: localEntry.fspath,
          remoteFsPath: upath.join(remoteFsPath, relPath),
          status: CompareStatus.NewLocal,
        });
        return;
      }

      remoteFiles.delete(relPath);
      if (isFileModified(localEntry, remoteEntry)) {
        entries.push({
          relPath,
          localFsPath: localEntry.fspath,
          remoteFsPath: remoteEntry.fspath,
          status: CompareStatus.Modified,
        });
      }
    });
    remoteFiles.forEach((remoteEntry, relPath) => {
      entries.push({
        relPath,
        localFsPath: path.join(localFsPath, relPath),
        remoteFsPath: remoteEntry.fspath,
        status: CompareStatus.NewRemote,
      });
    });
    entries.sort((a, b) => a.relPath.localeCompare(b.relPath));

    if (app.compareExplorer) {
      app.compareExplorer.setResult({
        localRoot: localFsPath,
        remoteRoot: remoteFsPath,
        serviceName: this.fileService.name,
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

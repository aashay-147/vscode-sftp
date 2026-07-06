import * as path from 'path';
import app from '../app';
import { upath, FileSystem, FileEntry, FileType } from '../core';
import { FileHandleOption } from './option';
import createFileHandler from './createFileHandler';

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

export interface CompareResult {
  localRoot: string;
  remoteRoot: string;
  serviceName?: string;
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
function diffStatus(a: FileEntry, b: FileEntry, compareMtime: boolean): CompareStatus | null {
  if (a.size !== b.size) {
    return CompareStatus.Modified;
  }
  if (compareMtime && Math.floor(a.mtime / 1000) !== Math.floor(b.mtime / 1000)) {
    return CompareStatus.TimeDiff;
  }
  return null;
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

    // FTP LIST mtimes can't be trusted (see diffStatus) — compare on size only.
    const compareMtime = this.config.protocol !== 'ftp';

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
      const status = diffStatus(localEntry, remoteEntry, compareMtime);
      if (status) {
        entries.push({
          relPath,
          localFsPath: localEntry.fspath,
          remoteFsPath: remoteEntry.fspath,
          status,
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

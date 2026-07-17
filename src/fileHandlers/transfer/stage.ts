// Staging engine for the Staged Transfer Workflow (Features 2+3).
// Walks both sides of a folder transfer with the same primitives the Folder
// Compare view uses (collectFiles + classifyPair), producing a full
// classification plus the identical-pair set, so the caller can show exact
// counts before anything moves and (with skipUnmodified) skip files that are
// already identical on the destination.

import * as path from 'path';
import { upath, FileSystem, FileEntry, TransferDirection } from '../../core';
import { FileHandleOption } from '../option';
import {
  collectFiles,
  classifyPair,
  CompareEntry,
  CompareResult,
  CompareStatus,
  WalkControl,
} from '../compare';

export interface StageCounts {
  // files that don't exist on the destination yet
  create: number;
  // files that exist on both sides with different content (size differs)
  overwriteModified: number;
  // files that exist on both sides, same size, different mtime
  overwriteTimeDiff: number;
  // files identical on both sides (size + mtime; size-only on FTP)
  identical: number;
}

export interface StagePlan {
  // full classification, ready for the Compare view (Review path)
  result: CompareResult;
  // ABSOLUTE source-side fsPaths of identical pairs — keyed by absolute path
  // because transferWithType only ever sees absolute paths (never the walk root)
  identical: string[];
  counts: StageCounts;
}

// The status a source-side entry must have to count as "create" for this
// direction. The opposite "new" status means destination-only: those entries
// still classify (they appear in Review) but are never part of the transfer
// set — explicit transfer never deletes or fetches destination extras.
function createStatus(direction: TransferDirection): CompareStatus {
  return direction === TransferDirection.LOCAL_TO_REMOTE
    ? CompareStatus.NewLocal
    : CompareStatus.NewRemote;
}

export async function stageFolderTransfer(args: {
  localFs: FileSystem;
  remoteFs: FileSystem;
  localFsPath: string;
  remoteFsPath: string;
  direction: TransferDirection;
  ignore: FileHandleOption['ignore'];
  compareMtime: boolean;
  serviceName?: string;
  control?: WalkControl;
}): Promise<StagePlan | null> {
  const {
    localFs,
    remoteFs,
    localFsPath,
    remoteFsPath,
    direction,
    ignore,
    compareMtime,
    serviceName,
    control,
  } = args;

  const localFiles = new Map<string, FileEntry>();
  const remoteFiles = new Map<string, FileEntry>();
  await Promise.all([
    collectFiles(localFs, localFsPath, localFsPath, ignore, localFiles, control),
    collectFiles(remoteFs, remoteFsPath, remoteFsPath, ignore, remoteFiles, control),
  ]);

  if (control && control.isCancelled()) {
    // partial walk — discard everything, transfer nothing
    return null;
  }

  const fromLocal = direction === TransferDirection.LOCAL_TO_REMOTE;
  const entries: CompareEntry[] = [];
  const identical: string[] = [];

  localFiles.forEach((localEntry, relPath) => {
    const remoteEntry = remoteFiles.get(relPath);
    if (remoteEntry) {
      remoteFiles.delete(relPath);
    }
    const entry = classifyPair(
      localEntry,
      remoteEntry || null,
      {
        relPath,
        localFsPath: localEntry.fspath,
        remoteFsPath: remoteEntry ? remoteEntry.fspath : upath.join(remoteFsPath, relPath),
      },
      compareMtime
    );
    if (entry) {
      entries.push(entry);
    } else if (remoteEntry) {
      identical.push(fromLocal ? localEntry.fspath : remoteEntry.fspath);
    }
  });
  remoteFiles.forEach((remoteEntry, relPath) => {
    const entry = classifyPair(
      null,
      remoteEntry,
      {
        relPath,
        localFsPath: path.join(localFsPath, relPath),
        remoteFsPath: remoteEntry.fspath,
      },
      compareMtime
    );
    if (entry) {
      entries.push(entry);
    }
  });
  entries.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const counts: StageCounts = {
    create: 0,
    overwriteModified: 0,
    overwriteTimeDiff: 0,
    identical: identical.length,
  };
  const create = createStatus(direction);
  entries.forEach(entry => {
    if (entry.status === create) {
      counts.create += 1;
    } else if (entry.status === CompareStatus.Modified) {
      counts.overwriteModified += 1;
    } else if (entry.status === CompareStatus.TimeDiff) {
      counts.overwriteTimeDiff += 1;
    }
    // the opposite "new" status is destination-only: shown in Review, never transferred
  });

  return {
    result: {
      localRoot: localFsPath,
      remoteRoot: remoteFsPath,
      serviceName,
      origin: { kind: 'folder', root: localFsPath },
      entries,
    },
    identical,
    counts,
  };
}

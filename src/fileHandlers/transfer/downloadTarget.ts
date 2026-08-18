// Local-mirror mapping for Feature 9 (`localDownloadPath`). The mirror is a
// bidirectional mapping between config.remotePath and the resolved base:
//   forward: remoteFsPath -> join(base, relative(remotePath, remoteFsPath))
//   inverse: localFsPath under base -> join(remotePath, relative(base, localFsPath))
// Only explicit transfer commands opt in via `useLocalDownloadPath`; every
// implicit flow (uploadOnSave, watcher, sync, downloadOnOpen, Edit in Local,
// List) keeps the workspace mapping untouched.

import { Uri } from 'vscode';
import { TransferDirection, UResource } from '../../core';
import {
  isPathUnder,
  resolveLocalDownloadPathBase,
  toLocalPath,
  toRemotePath,
} from '../../helper';
import { FileHandlerContext } from '../createFileHandler';
import { TransferOption } from './transfer';

export interface DownloadOption extends TransferOption {
  // Redirect the transfer through config.localDownloadPath (explicit
  // upload/download commands only). No-op when the config field is unset.
  useLocalDownloadPath?: boolean;
}

// The resolved absolute mirror base for this context, or undefined when
// localDownloadPath is not configured (for the active profile).
export function getDownloadPathBase(ctx: FileHandlerContext): string | undefined {
  return resolveLocalDownloadPathBase(ctx.config.localDownloadPath, ctx.fileService.baseDir);
}

export function isUnderDownloadPath(ctx: FileHandlerContext, localFsPath: string): boolean {
  const base = getDownloadPathBase(ctx);
  return Boolean(base && isPathUnder(base, localFsPath));
}

// Inverse mapping: the remote path a mirror-local file corresponds to, or null
// when no mirror is configured or the path is outside it.
export function resolveRemoteFsPathFromDownloadPath(
  ctx: FileHandlerContext,
  localFsPath: string
): string | null {
  const base = getDownloadPathBase(ctx);
  if (!base || !isPathUnder(base, localFsPath)) {
    return null;
  }

  return toRemotePath(localFsPath, base, ctx.config.remotePath);
}

// Pure upload-guard predicate: whenever a mirror is configured
// (localDownloadPath set), explicit uploads of files OUTSIDE it are blocked.
// The restriction is implicit - an out-of-mirror upload would land at the
// workspace-context mapping (or above remotePath for out-of-context files)
// and then circulate back into the mirror on the next download, so there is
// no safe unrestricted mode. Without a configured mirror nothing is blocked.
export function isUploadBlockedByDownloadPath(
  ctx: FileHandlerContext,
  localFsPath: string = ctx.target.localFsPath
): boolean {
  const base = getDownloadPathBase(ctx);
  if (!base) {
    return false;
  }

  return !isPathUnder(base, localFsPath);
}

// Effective transfer target under the mirror semantics. The side the user
// clicked is taken literally; the other side is derived:
//   - local path under the base  -> keep local, remote = inverse (uploads from
//     the mirror land on the true remote path; re-downloads land in place)
//   - download otherwise         -> keep remote, local = forward
//   - upload from outside        -> unchanged (subject to the upload guard)
// Returns ctx.target unchanged unless the option carries the flag and a base
// is configured. Idempotent: multiFileTransfer remaps at context-build time
// and the transfer handle remaps again.
export function resolveEffectiveTarget(
  ctx: FileHandlerContext,
  option: Pick<DownloadOption, 'useLocalDownloadPath'>,
  direction: TransferDirection
): UResource {
  if (!option.useLocalDownloadPath) {
    return ctx.target;
  }
  const base = getDownloadPathBase(ctx);
  if (!base) {
    return ctx.target;
  }

  const resourceConfig = {
    localBasePath: base,
    remoteBasePath: ctx.config.remotePath,
    remoteId: ctx.fileService.id,
    remote: {
      host: ctx.config.host,
      port: ctx.config.port,
    },
  };

  if (isPathUnder(base, ctx.target.localFsPath)) {
    // local side is literal - UResource.from derives remote via toRemotePath
    // against the mirror base, i.e. exactly the inverse mapping
    return UResource.from(Uri.file(ctx.target.localFsPath), resourceConfig);
  }

  if (direction === TransferDirection.REMOTE_TO_LOCAL) {
    // remote side is literal - UResource.from derives local via toLocalPath
    // against the mirror base, i.e. exactly the forward mapping
    return UResource.from(ctx.target.remoteUri, resourceConfig);
  }

  return ctx.target;
}

// Forward mapping helper for callers that need the mirror-local counterpart of
// a remote path without building a full UResource (compare roots).
export function toDownloadPathLocal(
  base: string,
  remotePath: string,
  remoteFsPath: string
): string {
  return toLocalPath(remoteFsPath, remotePath, base);
}

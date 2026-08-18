// Command-layer enforcement of `restrictUploadsToLocalDownloadPath`
// (Feature 9). Only explicit upload/sync commands call these — the transfer
// layer is untouched, so internal callers (uploadOnSave, watcher) are
// unaffected by design. The predicate itself lives in
// fileHandlers/transfer/downloadTarget.ts.

import { Uri } from 'vscode';
import { showWarningMessage } from '../host';
import { handleCtxFromUri, FileHandlerContext } from '../fileHandlers';
import {
  getDownloadPathBase,
  isUploadBlockedByDownloadPath,
} from '../fileHandlers/transfer/downloadTarget';
import { ctxFromCompareEntry } from './shared';

// True when the upload may proceed; otherwise shows the blocking warning and
// returns false. Callers simply `if (!ensureUploadAllowed(ctx)) return;`.
export function ensureUploadAllowed(ctx: FileHandlerContext): boolean {
  if (!isUploadBlockedByDownloadPath(ctx)) {
    return true;
  }

  showWarningMessage(
    `'${ctx.target.localFsPath}' is outside localDownloadPath (${getDownloadPathBase(
      ctx
    )}) — upload blocked by restrictUploadsToLocalDownloadPath`
  );
  return false;
}

// Compare-group variant: drop blocked entries with ONE aggregate warning.
// Entries whose context can't be resolved pass through — the action itself
// reports the real error.
export function filterUploadableCompareEntries<
  T extends { localFsPath: string; remoteFsPath: string; serviceId?: number }
>(entries: T[]): T[] {
  let blockedCount = 0;
  const allowed = entries.filter(entry => {
    try {
      if (isUploadBlockedByDownloadPath(ctxFromCompareEntry(entry))) {
        blockedCount += 1;
        return false;
      }
    } catch (error) {
      // unresolvable entry — let the action surface the real error
    }
    return true;
  });

  if (blockedCount > 0) {
    showWarningMessage(
      `${blockedCount} file(s) outside localDownloadPath — upload blocked by restrictUploadsToLocalDownloadPath`
    );
  }
  return allowed;
}

// Multi-select variant: drop the blocked uris and show ONE aggregate warning.
// Uris that don't resolve to a config pass through — the transfer path reports
// those with its own error.
export function filterUploadableUris(uris: Uri[]): Uri[] {
  const allowed: Uri[] = [];
  const blocked: string[] = [];
  for (const uri of uris) {
    let ctx: FileHandlerContext;
    try {
      ctx = handleCtxFromUri(uri);
    } catch (error) {
      allowed.push(uri);
      continue;
    }
    if (isUploadBlockedByDownloadPath(ctx)) {
      blocked.push(ctx.target.localFsPath);
    } else {
      allowed.push(uri);
    }
  }

  if (blocked.length > 0) {
    showWarningMessage(
      `${blocked.length} file(s) outside localDownloadPath — upload blocked by restrictUploadsToLocalDownloadPath`
    );
  }
  return allowed;
}

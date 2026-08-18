// Command-layer enforcement of the localDownloadPath upload restriction
// (Feature 9). Only explicit upload/sync commands call these - the transfer
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

// Points the user at the opt-in menu graying when they hit the guard the hard
// way. Suppressed once the setting is already on - the grayed items speak for
// themselves and only guard-only surfaces (palette, multi-select) reach here.
function menuHint(ctx: FileHandlerContext | undefined): string {
  return !ctx || ctx.config.disableUploadMenusOutsideLocalDownloadPath
    ? ''
    : ' (set "disableUploadMenusOutsideLocalDownloadPath": true to gray out these menu items)';
}

// True when the upload may proceed; otherwise shows the blocking warning and
// returns false. Callers simply `if (!ensureUploadAllowed(ctx)) return;`.
export function ensureUploadAllowed(ctx: FileHandlerContext): boolean {
  if (!isUploadBlockedByDownloadPath(ctx)) {
    return true;
  }

  showWarningMessage(
    `'${ctx.target.localFsPath}' is outside localDownloadPath (${getDownloadPathBase(
      ctx
    )}) - upload blocked${menuHint(ctx)}`
  );
  return false;
}

// Compare-group variant: drop blocked entries with ONE aggregate warning.
// Entries whose context can't be resolved pass through - the action itself
// reports the real error.
export function filterUploadableCompareEntries<
  T extends { localFsPath: string; remoteFsPath: string; serviceId?: number }
>(entries: T[]): T[] {
  let blockedCount = 0;
  let blockedCtx: FileHandlerContext | undefined;
  const allowed = entries.filter(entry => {
    try {
      const ctx = ctxFromCompareEntry(entry);
      if (isUploadBlockedByDownloadPath(ctx)) {
        blockedCount += 1;
        blockedCtx = ctx;
        return false;
      }
    } catch (error) {
      // unresolvable entry - let the action surface the real error
    }
    return true;
  });

  if (blockedCount > 0) {
    showWarningMessage(
      `${blockedCount} file(s) outside localDownloadPath - upload blocked${menuHint(blockedCtx)}`
    );
  }
  return allowed;
}

// Multi-select variant: drop the blocked uris and show ONE aggregate warning.
// Uris that don't resolve to a config pass through - the transfer path reports
// those with its own error.
export function filterUploadableUris(uris: Uri[]): Uri[] {
  const allowed: Uri[] = [];
  const blocked: string[] = [];
  let blockedCtx: FileHandlerContext | undefined;
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
      blockedCtx = ctx;
    } else {
      allowed.push(uri);
    }
  }

  if (blocked.length > 0) {
    showWarningMessage(
      `${blocked.length} file(s) outside localDownloadPath - upload blocked${menuHint(blockedCtx)}`
    );
  }
  return allowed;
}

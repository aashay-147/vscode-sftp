// Maintains the context keys behind the `enablement` clauses in package.json
// that gray out upload/sync-up menu items for files outside the
// localDownloadPath mirror (opt-in via disableUploadMenusOutsideLocalDownloadPath).
//
//   sftp.uploadRestricted  - boolean master switch for the clauses
//   sftp.uploadableDirs    - object keyed by allowed directory fsPaths, tested
//                            with the `in` operator against resourceDirname
//                            (files) / resourcePath (folders)
//
// This is UX sugar only: the runtime guard in commands/uploadGuard.ts is the
// enforcement layer. Therefore every failure here fails OPEN (menus enabled):
// walk errors, missing mirror folders, and mirrors larger than MAX_DIRS.

import * as fs from 'fs';
import * as path from 'path';
import { Uri } from 'vscode';
import { setContextValue } from '../host';
import { resolveLocalDownloadPathBase } from '../helper';
import { getAllFileService } from './serviceManager';

// Fail-open cap so a misconfigured mirror (e.g. pointed at $HOME) can't stall
// activation walking millions of directories.
const MAX_DIRS = 20000;
const DEBOUNCE_MS = 300;

// Every allowed directory under the given mirror bases (the bases themselves
// included), keyed by fsPath for the `in` operator. Returns null when the walk
// exceeds MAX_DIRS - callers must fail open. Symlinked directories are skipped
// (cycle safety); unreadable or not-yet-created directories still contribute
// their own key so mirror files never get wrongly disabled.
export function collectUploadableDirs(bases: string[]): { [fsPath: string]: true } | null {
  const dirs: { [fsPath: string]: true } = {};
  let count = 0;
  // Uri.file(...).fsPath normalizes exactly like the resourceDirname /
  // resourcePath context values (drive-letter casing on win32) - keys must
  // byte-match because `in` is an exact string test.
  const stack = bases.map(base => Uri.file(base).fsPath);

  while (stack.length > 0) {
    const dir = stack.pop()!;
    if (dirs[dir]) {
      continue;
    }
    if (count >= MAX_DIRS) {
      return null;
    }
    dirs[dir] = true;
    count += 1;

    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch (error) {
      continue;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(full);
      } catch (error) {
        continue;
      }
      // lstat does not follow symlinks, so a symlinked directory reports
      // isDirectory() false and is skipped (cycle safety)
      if (stat.isDirectory()) {
        stack.push(full);
      }
    }
  }

  return dirs;
}

let timer: ReturnType<typeof setTimeout> | null = null;

// Debounced refresh - safe to call from every trigger (activation, config
// save, profile switch, after downloads); bursts collapse into one walk.
export function refreshUploadMenuContext(): void {
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(doRefresh, DEBOUNCE_MS);
}

function doRefresh(): void {
  timer = null;

  const bases: string[] = [];
  for (const fileService of getAllFileService()) {
    let config;
    try {
      config = fileService.getConfig();
    } catch (error) {
      // unresolvable profile - skip this service, fail open for it
      continue;
    }
    if (!config.disableUploadMenusOutsideLocalDownloadPath) {
      continue;
    }
    const base = resolveLocalDownloadPathBase(config.localDownloadPath, fileService.baseDir);
    if (base) {
      bases.push(base);
    }
  }

  if (bases.length === 0) {
    setContextValue('uploadRestricted', false);
    return;
  }

  const dirs = collectUploadableDirs(bases);
  if (dirs === null) {
    setContextValue('uploadRestricted', false);
    return;
  }

  // dirs first, then the switch - never a window where the clauses evaluate
  // against a stale allow-set with the restriction already on
  setContextValue('uploadableDirs', dirs);
  setContextValue('uploadRestricted', true);
}

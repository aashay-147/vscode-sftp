import * as os from 'os';
import * as path from 'path';
import { upath } from '../core';
import { pathRelativeToWorkspace, getWorkspaceFolders } from '../host';

export function simplifyPath(absolutePath: string) {
  return pathRelativeToWorkspace(absolutePath);
}

// FIXME: use fs.pathResolver instead of upath
export function toRemotePath(localPath: string, localContext: string, remoteContext: string) {
  return upath.join(remoteContext, path.relative(localContext, localPath));
}

// FIXME: use fs.pathResolver instead of upath
export function toLocalPath(remotePath: string, remoteContext: string, localContext: string) {
  return path.join(localContext, upath.relative(remoteContext, remotePath));
}

export function isSubpathOf(possiableParentPath: string, pathname: string) {
  return path.normalize(pathname).indexOf(path.normalize(possiableParentPath)) === 0;
}

export function replaceHomePath(pathname: string) {
  return pathname.substr(0, 2) === '~/' ? path.join(os.homedir(), pathname.slice(2)) : pathname;
}

// Boundary-safe "is pathname inside (or equal to) basePath". Unlike isSubpathOf
// above, a sibling whose name merely starts with basePath's (`/a/_downloadsX`
// vs `/a/_downloads`) is NOT a match. Case-insensitive on win32, matching the
// stance of isInWorkspace below.
export function isPathUnder(basePath: string, pathname: string): boolean {
  let base = path.normalize(basePath);
  let target = path.normalize(pathname);
  if (process.platform === 'win32') {
    base = base.toLowerCase();
    target = target.toLowerCase();
  }
  const rel = path.relative(base, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

// Resolve the configured localDownloadPath (Feature 9) to an absolute mirror
// base: `~/` expands to the home dir, a relative path joins onto the service's
// baseDir (join, not resolve - same rationale as serviceManager.getBasePath),
// an absolute path is taken as-is. Returns undefined when unset so every
// caller can treat "no mirror" as a structural no-op.
export function resolveLocalDownloadPathBase(
  localDownloadPath: string | undefined,
  baseDir: string
): string | undefined {
  if (!localDownloadPath) {
    return undefined;
  }

  const expanded = replaceHomePath(localDownloadPath);
  const absolute = path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded);
  return path.normalize(absolute);
}

export function resolvePath(from: string, to: string) {
  return path.resolve(from, replaceHomePath(to));
}

export function isInWorkspace(filepath: string) {
  const workspaceFolders = getWorkspaceFolders();
  return (
    workspaceFolders &&
    workspaceFolders.some(
      // vscode can't keep filepath's stable, covert them to toLowerCase before check
      folder => filepath.toLowerCase().indexOf(folder.uri.fsPath.toLowerCase()) === 0
    )
  );
}

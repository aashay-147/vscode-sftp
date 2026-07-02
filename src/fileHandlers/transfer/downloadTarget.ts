import * as path from 'path';
import { upath } from '../../core';
import { replaceHomePath } from '../../helper';
import { FileHandlerContext } from '../createFileHandler';
import { TransferOption } from './transfer';

export interface DownloadOption extends TransferOption {
  // redirect the destination to config.downloadPath (explicit download commands only)
  useDownloadPath?: boolean;
}

// Only explicit download commands pass useDownloadPath. Everything else must keep
// the context-mapped path — downloadOnOpen and "Edit in Local" open target.localUri
// right after downloading.
export function resolveDownloadTargetFsPath(
  ctx: FileHandlerContext,
  option: Pick<DownloadOption, 'useDownloadPath'>
): string {
  const { localFsPath, remoteFsPath } = ctx.target;
  const downloadPath = ctx.config.downloadPath;
  if (!option.useDownloadPath || !downloadPath) {
    return localFsPath;
  }

  const basePath = replaceHomePath(downloadPath);
  const absBasePath = path.isAbsolute(basePath)
    ? basePath
    : // join, not resolve — same reason as serviceManager.getBasePath
      path.join(ctx.fileService.baseDir, basePath);
  return path.join(absBasePath, upath.relative(ctx.config.remotePath, remoteFsPath));
}

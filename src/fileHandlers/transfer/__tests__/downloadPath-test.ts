import * as os from 'os';
import * as path from 'path';
import { resolveDownloadTargetFsPath } from '../downloadTarget';
import { FileHandlerContext } from '../../createFileHandler';

const BASE_DIR = path.join(path.sep, 'workspace', 'project');

function createCtx(config: { downloadPath?: string; remoteFsPath?: string }): FileHandlerContext {
  const remoteFsPath = config.remoteFsPath || '/var/www/src/a.txt';
  return {
    target: {
      localFsPath: path.join(BASE_DIR, 'src', 'a.txt'),
      remoteFsPath,
    },
    config: {
      remotePath: '/var/www',
      downloadPath: config.downloadPath,
    },
    fileService: {
      baseDir: BASE_DIR,
    },
  } as any;
}

describe('resolveDownloadTargetFsPath', () => {
  test('keeps context-mapped path without useDownloadPath', () => {
    const ctx = createCtx({ downloadPath: 'downloads' });
    expect(resolveDownloadTargetFsPath(ctx, {})).toEqual(path.join(BASE_DIR, 'src', 'a.txt'));
  });

  test('keeps context-mapped path when downloadPath is not configured', () => {
    const ctx = createCtx({});
    expect(resolveDownloadTargetFsPath(ctx, { useDownloadPath: true })).toEqual(
      path.join(BASE_DIR, 'src', 'a.txt')
    );
  });

  test('relative downloadPath resolves against the context base dir', () => {
    const ctx = createCtx({ downloadPath: 'downloads' });
    expect(resolveDownloadTargetFsPath(ctx, { useDownloadPath: true })).toEqual(
      path.join(BASE_DIR, 'downloads', 'src', 'a.txt')
    );
  });

  test('absolute downloadPath is honored as-is', () => {
    const absolute = path.join(path.sep, 'tmp', 'dl');
    const ctx = createCtx({ downloadPath: absolute });
    expect(resolveDownloadTargetFsPath(ctx, { useDownloadPath: true })).toEqual(
      path.join(absolute, 'src', 'a.txt')
    );
  });

  test('~/ downloadPath resolves against the home dir', () => {
    const ctx = createCtx({ downloadPath: '~/dl' });
    expect(resolveDownloadTargetFsPath(ctx, { useDownloadPath: true })).toEqual(
      path.join(os.homedir(), 'dl', 'src', 'a.txt')
    );
  });

  test('downloading the remote root lands in downloadPath itself', () => {
    const ctx = createCtx({ downloadPath: 'downloads', remoteFsPath: '/var/www' });
    expect(resolveDownloadTargetFsPath(ctx, { useDownloadPath: true })).toEqual(
      path.join(BASE_DIR, 'downloads')
    );
  });
});

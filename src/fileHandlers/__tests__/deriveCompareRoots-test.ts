// Feature 9 — deriveCompareRoots: which local/remote pair a folder compare
// walks under the mirror semantics (clicked side literal, other side derived).

jest.mock('vscode', () => {
  const catchAll = jest.requireActual('../../../__mocks__/vscode');
  return new Proxy(
    { Uri: class Uri {} },
    { get: (target, key) => (key in target ? target[key] : catchAll[key]) }
  );
});
jest.mock('../../app', () => ({
  __esModule: true,
  default: {
    sftpBarItem: { startSpinner: jest.fn(), stopSpinner: jest.fn() },
    compareExplorer: { setResult: jest.fn() },
  },
}));
jest.mock('../createFileHandler', () => ({
  __esModule: true,
  // compare.ts calls createFileHandler() at module load — return an inert handler
  default: () => jest.fn(async () => undefined),
  handleCtxFromUri: jest.fn(),
}));

import * as path from 'path';
import { deriveCompareRoots } from '../compare';

const BASE_DIR = path.join(path.sep, 'workspace', 'project');
const MIRROR = path.join(BASE_DIR, '_downloads');

function derive(args: {
  localDownloadPath?: string;
  localFsPath: string;
  remoteFsPath: string;
  remoteOrigin?: boolean;
}) {
  return deriveCompareRoots({
    config: { remotePath: '/var/www', localDownloadPath: args.localDownloadPath },
    baseDir: BASE_DIR,
    target: { localFsPath: args.localFsPath, remoteFsPath: args.remoteFsPath },
    remoteOrigin: Boolean(args.remoteOrigin),
  });
}

describe('deriveCompareRoots', () => {
  test('no base: identity on the target (current behavior)', () => {
    expect(
      derive({
        localFsPath: path.join(BASE_DIR, 'src'),
        remoteFsPath: '/var/www/src',
      })
    ).toEqual({ localRoot: path.join(BASE_DIR, 'src'), remoteRoot: '/var/www/src' });
  });

  test('local root under the base: remote root is the inverse mapping', () => {
    expect(
      derive({
        localDownloadPath: '_downloads',
        localFsPath: path.join(MIRROR, 'src'),
        // workspace-mapped remote would be /var/www/_downloads/src — discarded
        remoteFsPath: '/var/www/_downloads/src',
      })
    ).toEqual({ localRoot: path.join(MIRROR, 'src'), remoteRoot: '/var/www/src' });
  });

  test('the base itself maps to remotePath', () => {
    expect(
      derive({
        localDownloadPath: '_downloads',
        localFsPath: MIRROR,
        remoteFsPath: '/var/www/_downloads',
      })
    ).toEqual({ localRoot: MIRROR, remoteRoot: '/var/www' });
  });

  test('remote origin: local root is the forward-mapped mirror path', () => {
    expect(
      derive({
        localDownloadPath: '_downloads',
        localFsPath: path.join(BASE_DIR, 'src'),
        remoteFsPath: '/var/www/src',
        remoteOrigin: true,
      })
    ).toEqual({ localRoot: path.join(MIRROR, 'src'), remoteRoot: '/var/www/src' });
  });

  test('local origin outside the base: identity (workspace compare unchanged)', () => {
    expect(
      derive({
        localDownloadPath: '_downloads',
        localFsPath: path.join(BASE_DIR, 'src'),
        remoteFsPath: '/var/www/src',
      })
    ).toEqual({ localRoot: path.join(BASE_DIR, 'src'), remoteRoot: '/var/www/src' });
  });
});

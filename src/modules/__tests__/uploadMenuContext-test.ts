// Feature 9 follow-up - context keys behind the upload-menu `enablement`
// clauses. Covers the mirror walk (collectUploadableDirs) against real temp
// trees and the debounced refresh's mode matrix via mocked services.

jest.mock('vscode', () => {
  // real Uri semantics (fsPath normalization must match the walk keys) + the
  // inert catch-all for everything else the transitive imports touch
  const catchAll = jest.requireActual('../../../__mocks__/vscode');
  const URI = require('vscode-uri').default;
  return new Proxy(
    { Uri: URI },
    { get: (target, key) => (key in target ? target[key] : catchAll[key]) }
  );
});

jest.mock('../../host', () => ({
  ...jest.requireActual('../../host'),
  setContextValue: jest.fn(),
}));

jest.mock('../serviceManager', () => ({
  getAllFileService: jest.fn(() => []),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Uri } from 'vscode';
import { setContextValue } from '../../host';
import { getAllFileService } from '../serviceManager';
import { collectUploadableDirs, refreshUploadMenuContext } from '../uploadMenuContext';

const mockedSetContextValue = setContextValue as jest.Mock;
const mockedGetAllFileService = getAllFileService as jest.Mock;

function makeTree(dirs: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-menu-test-'));
  // no { recursive } - the pinned @types/node predates it
  dirs.forEach(dir => {
    let current = root;
    for (const part of dir.split('/')) {
      current = path.join(current, part);
      if (!fs.existsSync(current)) {
        fs.mkdirSync(current);
      }
    }
  });
  return root;
}

function fakeService(config: {
  localDownloadPath?: string;
  disableUploadMenusOutsideLocalDownloadPath?: boolean;
  baseDir: string;
}) {
  return {
    baseDir: config.baseDir,
    getConfig: () => config,
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('collectUploadableDirs', () => {
  test('collects the base and every descendant directory, files ignored', () => {
    const root = makeTree(['_downloads/src/lib', '_downloads/assets']);
    fs.writeFileSync(path.join(root, '_downloads', 'a.txt'), 'x');
    const base = path.join(root, '_downloads');

    const dirs = collectUploadableDirs([base]);

    expect(dirs).toEqual({
      [Uri.file(base).fsPath]: true,
      [Uri.file(path.join(base, 'src')).fsPath]: true,
      [Uri.file(path.join(base, 'src', 'lib')).fsPath]: true,
      [Uri.file(path.join(base, 'assets')).fsPath]: true,
    });
  });

  test('sibling folder with the base as a name prefix is not collected', () => {
    const root = makeTree(['_downloads', '_downloadsX']);
    const base = path.join(root, '_downloads');

    const dirs = collectUploadableDirs([base])!;

    expect(dirs[Uri.file(path.join(root, '_downloadsX')).fsPath]).toBeUndefined();
  });

  test('not-yet-created base still contributes its own key (fail open)', () => {
    const root = makeTree([]);
    const base = path.join(root, 'missing');

    expect(collectUploadableDirs([base])).toEqual({
      [Uri.file(base).fsPath]: true,
    });
  });

  test('multiple bases merge into one set', () => {
    const root = makeTree(['a/x', 'b']);
    const baseA = path.join(root, 'a');
    const baseB = path.join(root, 'b');

    const dirs = collectUploadableDirs([baseA, baseB])!;

    expect(dirs[Uri.file(baseA).fsPath]).toBe(true);
    expect(dirs[Uri.file(path.join(baseA, 'x')).fsPath]).toBe(true);
    expect(dirs[Uri.file(baseB).fsPath]).toBe(true);
  });

  test('symlinked directories are skipped (no cycle, no escape)', () => {
    const root = makeTree(['_downloads/real', 'outside']);
    const base = path.join(root, '_downloads');
    try {
      fs.symlinkSync(path.join(root, 'outside'), path.join(base, 'link'), 'dir');
    } catch (error) {
      return; // symlinks unavailable (e.g. Windows without privilege) - skip
    }

    const dirs = collectUploadableDirs([base])!;

    expect(dirs[Uri.file(path.join(base, 'link')).fsPath]).toBeUndefined();
    expect(dirs[Uri.file(path.join(root, 'outside')).fsPath]).toBeUndefined();
  });

  test('returns null over the directory cap (fail open)', () => {
    const root = makeTree([]);
    const base = path.join(root, 'wide');
    fs.mkdirSync(base);
    // cap is 20000; a shallow tree over the cap must abort, not truncate
    for (let i = 0; i < 20005; i++) {
      fs.mkdirSync(path.join(base, `d${i}`));
    }

    expect(collectUploadableDirs([base])).toBeNull();
  });
});

describe('refreshUploadMenuContext', () => {
  // real timers - the debounce is 300ms, wait it out
  function flush() {
    return new Promise(resolve => setTimeout(resolve, 400));
  }

  test('no services: restriction off', async () => {
    refreshUploadMenuContext();
    await flush();

    expect(mockedSetContextValue).toHaveBeenCalledWith('uploadRestricted', false);
    expect(mockedSetContextValue).not.toHaveBeenCalledWith('uploadRestricted', true);
  });

  test('mirror set but menu-disabling off: restriction off, no walk keys', async () => {
    const root = makeTree(['_downloads']);
    mockedGetAllFileService.mockReturnValue([
      fakeService({ localDownloadPath: '_downloads', baseDir: root }),
    ]);

    refreshUploadMenuContext();
    await flush();

    expect(mockedSetContextValue).toHaveBeenCalledWith('uploadRestricted', false);
    expect(mockedSetContextValue).not.toHaveBeenCalledWith('uploadableDirs', expect.anything());
  });

  test('menu-disabling on without a mirror: inert, restriction off', async () => {
    const root = makeTree([]);
    mockedGetAllFileService.mockReturnValue([
      fakeService({ disableUploadMenusOutsideLocalDownloadPath: true, baseDir: root }),
    ]);

    refreshUploadMenuContext();
    await flush();

    expect(mockedSetContextValue).toHaveBeenCalledWith('uploadRestricted', false);
  });

  test('opted in: publishes the allow-set, dirs before the switch', async () => {
    const root = makeTree(['_downloads/src']);
    mockedGetAllFileService.mockReturnValue([
      fakeService({
        localDownloadPath: '_downloads',
        disableUploadMenusOutsideLocalDownloadPath: true,
        baseDir: root,
      }),
    ]);

    refreshUploadMenuContext();
    await flush();

    const calls = mockedSetContextValue.mock.calls;
    const dirsIndex = calls.findIndex(call => call[0] === 'uploadableDirs');
    const onIndex = calls.findIndex(call => call[0] === 'uploadRestricted' && call[1] === true);
    expect(dirsIndex).toBeGreaterThanOrEqual(0);
    expect(onIndex).toBeGreaterThan(dirsIndex);
    expect(calls[dirsIndex][1][Uri.file(path.join(root, '_downloads', 'src')).fsPath]).toBe(true);
  });

  test('service whose getConfig throws is skipped, others still gate', async () => {
    const root = makeTree(['_downloads']);
    mockedGetAllFileService.mockReturnValue([
      {
        baseDir: root,
        getConfig: () => {
          throw new Error('unknown profile');
        },
      },
      fakeService({
        localDownloadPath: '_downloads',
        disableUploadMenusOutsideLocalDownloadPath: true,
        baseDir: root,
      }),
    ]);

    refreshUploadMenuContext();
    await flush();

    expect(mockedSetContextValue).toHaveBeenCalledWith('uploadRestricted', true);
  });

  test('bursts debounce into a single walk', async () => {
    refreshUploadMenuContext();
    refreshUploadMenuContext();
    refreshUploadMenuContext();
    await flush();

    expect(
      mockedSetContextValue.mock.calls.filter(call => call[0] === 'uploadRestricted').length
    ).toBe(1);
  });
});

describe('disableUploadMenusOutsideLocalDownloadPath config validation', () => {
  // validateConfig pulls in the real config module (host mocked above)
  const { validateConfig } = require('../config');
  const base = { host: 'host', username: 'username', remotePath: '/' };

  test.each([[false], [true]])('accepts %p', value => {
    expect(
      validateConfig({ ...base, disableUploadMenusOutsideLocalDownloadPath: value })
    ).toBeFalsy();
  });

  test('rejects a string', () => {
    expect(
      validateConfig({ ...base, disableUploadMenusOutsideLocalDownloadPath: 'yes' })
    ).toBeTruthy();
  });
});

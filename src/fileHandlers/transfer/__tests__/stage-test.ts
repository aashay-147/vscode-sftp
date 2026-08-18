// Feature 3 - the staging engine (stage.ts). Classification counts on a
// synthetic tree in both directions, the FTP size-only basis, and the
// cancelled-walk contract (partial plan discarded, null returned).

jest.mock('fs');
// compare.ts (via stage.ts) transitively pulls in app/serviceManager - break
// the require cycle exactly as createFileHandler-test does.
jest.mock('vscode', () => {
  const catchAll = jest.requireActual('../../../../__mocks__/vscode');
  return new Proxy(
    { Uri: class Uri {} },
    { get: (target, key) => (key in target ? target[key] : catchAll[key]) }
  );
});
jest.mock('../../../app', () => ({
  __esModule: true,
  default: { sftpBarItem: { startSpinner: jest.fn(), stopSpinner: jest.fn() } },
}));
jest.mock('../../../modules/serviceManager', () => ({
  getFileService: jest.fn(),
}));

import { vol } from 'memfs';
import * as fs from 'fs';
import * as path from 'path';
import localFs from '../../../core/localFs';
import { TransferDirection } from '../../../core';
import { CompareStatus } from '../../compare';
import { stageFolderTransfer } from '../stage';

// fixed epoch so same/different mtimes are deterministic (never flaky across
// a wall-clock second boundary)
const EPOCH = 1500000000000;
const file = (content: string, timeOffsetSeconds = 0) => ({
  $$type: 'file',
  content,
  mtime: new Date(EPOCH + timeOffsetSeconds * 1000),
});

const fillFs = obj => {
  const files: { [x: string]: string } = {};
  const dirs: string[] = [];
  const stats: { [x: string]: { mtime: Date } } = {};
  const processDirTree = (obj1, filepath = '/') => {
    const keys = Object.keys(obj1);
    if (keys.length <= 0) {
      dirs.push(filepath);
      return;
    }
    keys.forEach(key => {
      const fullpath = path.join(filepath, key);
      if (obj1[key].$$type === 'file') {
        files[fullpath] = obj1[key].content;
        stats[fullpath] = obj1[key];
      } else {
        processDirTree(obj1[key], fullpath);
      }
    });
  };
  processDirTree(obj);
  vol.fromJSON(files, '/');
  dirs.forEach(dir => fs.mkdirSync(dir));
  Object.keys(stats).forEach(filepath => {
    fs.utimesSync(filepath, stats[filepath].mtime, stats[filepath].mtime);
  });
};

// local: newl + sub/nested (create), mod (content differs), tdiff (same size,
// different mtime), same (identical). remote extra: remoteonly.
function fillSyntheticTree() {
  fillFs({
    local: {
      folder: {
        newl: file('new local'),
        mod: file('local version'),
        tdiff: file('12345', 60),
        same: file('unchanged'),
        sub: { nested: file('nested new') },
      },
    },
    remote: {
      folder: {
        mod: file('remote'),
        tdiff: file('54321'),
        same: file('unchanged'),
        remoteonly: file('only remote'),
      },
    },
  });
}

function stage(direction: TransferDirection, extra: object = {}) {
  return stageFolderTransfer({
    localFs,
    remoteFs: localFs,
    localFsPath: '/local/folder',
    remoteFsPath: '/remote/folder',
    direction,
    ignore: null,
    compareMtime: true,
    serviceName: 'test',
    serviceId: 7,
    originUri: 'file:///local/folder',
    ...extra,
  });
}

describe('stageFolderTransfer (Feature 3 staging engine)', () => {
  afterEach(() => {
    vol.reset();
  });

  test('upload: counts and identical set (absolute LOCAL paths)', async () => {
    fillSyntheticTree();

    const plan = await stage(TransferDirection.LOCAL_TO_REMOTE);

    expect(plan).not.toBeNull();
    expect(plan!.counts).toEqual({
      create: 2, // newl + sub/nested
      overwriteModified: 1, // mod
      overwriteTimeDiff: 1, // tdiff
      identical: 1, // same
    });
    expect(plan!.identical).toEqual(['/local/folder/same']);
    // destination-only file is classified (visible in Review) but is not a count
    const remoteOnly = plan!.result.entries.find(e => e.relPath === 'remoteonly');
    expect(remoteOnly!.status).toBe(CompareStatus.NewRemote);
    expect(plan!.result.origin).toEqual({ kind: 'folder', uri: 'file:///local/folder' });
    expect(plan!.result.serviceId).toBe(7);
    // every entry is stamped with the owning service id
    expect(plan!.result.entries.every(e => e.serviceId === 7)).toBe(true);
  });

  test('download: create counts the remote-only file, identical keyed by REMOTE path', async () => {
    fillSyntheticTree();

    const plan = await stage(TransferDirection.REMOTE_TO_LOCAL);

    expect(plan!.counts).toEqual({
      create: 1, // remoteonly
      overwriteModified: 1,
      overwriteTimeDiff: 1,
      identical: 1,
    });
    expect(plan!.identical).toEqual(['/remote/folder/same']);
  });

  test('FTP basis (compareMtime false): same-size files are identical, TimeDiff impossible', async () => {
    fillSyntheticTree();

    const plan = await stage(TransferDirection.LOCAL_TO_REMOTE, { compareMtime: false });

    expect(plan!.counts.overwriteTimeDiff).toBe(0);
    expect(plan!.counts.identical).toBe(2); // same + tdiff (same size)
  });

  test('mirror-rooted staging (Feature 9): entries live under the mirror, identical keyed by source side', async () => {
    // same tree, but the local side lives under a localDownloadPath mirror
    fillFs({
      local: {
        _downloads: {
          folder: {
            mod: file('local version'),
            same: file('unchanged'),
          },
        },
      },
      remote: {
        folder: {
          mod: file('remote'),
          same: file('unchanged'),
          remoteonly: file('only remote'),
        },
      },
    });

    const plan = await stage(TransferDirection.REMOTE_TO_LOCAL, {
      localFsPath: '/local/_downloads/folder',
      originUri: 'file:///local/_downloads/folder',
    });

    expect(plan!.counts).toEqual({
      create: 1, // remoteonly
      overwriteModified: 1,
      overwriteTimeDiff: 0,
      identical: 1,
    });
    // every classified entry roots under the mirror on the local side
    expect(
      plan!.result.entries.every(e => e.localFsPath.startsWith('/local/_downloads/folder/'))
    ).toBe(true);
    // download direction: identical keyed by the REMOTE (source) side
    expect(plan!.identical).toEqual(['/remote/folder/same']);
    expect(plan!.result.localRoot).toBe('/local/_downloads/folder');
  });

  test('cancelled walk: plan discarded, null returned', async () => {
    fillSyntheticTree();

    const plan = await stage(TransferDirection.LOCAL_TO_REMOTE, {
      control: { isCancelled: () => true },
    });

    expect(plan).toBeNull();
  });
});

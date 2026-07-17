// Features 2+3 — the staged folder flow end to end through the real handler
// (createTransferHandle → stageAndConfirmFolderTransfer → transfer):
// counts modal, corrected zero-overwrite fast path, Review handoff, _skipSet
// selection, walk cancellation, the multi-profile modal variant, and the
// flags-off zero-extra-round-trip guarantee.

jest.mock('fs');
jest.mock('vscode', () => {
  const catchAll = jest.requireActual('../../../../__mocks__/vscode');
  return new Proxy(
    { Uri: class Uri {} },
    { get: (target, key) => (key in target ? target[key] : catchAll[key]) }
  );
});
jest.mock('../../../app', () => ({
  __esModule: true,
  default: {
    sftpBarItem: { startSpinner: jest.fn(), stopSpinner: jest.fn() },
    compareExplorer: { setResult: jest.fn() },
    remoteExplorer: { refresh: jest.fn() },
  },
}));
jest.mock('../../../modules/serviceManager', () => ({
  getFileService: jest.fn(),
}));
jest.mock('../../../host', () => ({
  ...jest.requireActual('../../../host'),
  getOpenTextDocuments: jest.fn(() => []),
  showConfirmMessageModal: jest.fn(),
  showModalChoices: jest.fn(),
  showInformationMessage: jest.fn(),
  executeCommand: jest.fn(),
  // run the walk task inline, not cancelled (individual tests override)
  showCancellableProgress: jest.fn((_title, task) => task(() => undefined, () => false)),
}));

import { vol } from 'memfs';
import * as fs from 'fs';
import * as path from 'path';
import app from '../../../app';
import localFs from '../../../core/localFs';
import {
  showCancellableProgress,
  showInformationMessage,
  showModalChoices,
} from '../../../host';
import { download } from '../index';
import { StagedTransferCancelledError } from '../stagedTransfer';

const modalChoices = showModalChoices as jest.Mock;
const infoToast = showInformationMessage as jest.Mock;
const progress = showCancellableProgress as jest.Mock;
const setResult = (app as any).compareExplorer.setResult as jest.Mock;

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

// download direction: source = remote. newr → create; mod → overwrite;
// same → identical.
function fillDefaultTree() {
  fillFs({
    remote: { folder: { newr: file('new remote'), mod: file('remote version'), same: file('unchanged') } },
    local: { folder: { mod: file('local'), same: file('unchanged') } },
  });
}

function makeCtx(configOverrides: object = {}) {
  const tasks: any[] = [];
  const scheduler = {
    size: 0,
    add: t => tasks.push(t),
    run: jest.fn(async () => undefined),
    stop: jest.fn(),
  };
  const ctx: any = {
    target: { localFsPath: '/local/folder', remoteFsPath: '/remote/folder' },
    fileService: {
      name: 'test-service',
      baseDir: '/local',
      getRemoteFileSystem: async () => localFs,
      getLocalFileSystem: () => localFs,
      createTransferScheduler: () => scheduler,
    },
    config: {
      protocol: 'sftp',
      concurrency: 4,
      host: 'example.com',
      remotePath: '/remote',
      ...configOverrides,
    },
  };
  return { ctx, tasks, scheduler };
}

describe('staged folder transfer (Features 2+3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    progress.mockImplementation((_title, task) => task(() => undefined, () => false));
  });
  afterEach(() => {
    vol.reset();
  });

  test('counts modal, Transfer accepted, skipUnmodified off: identical files re-transferred', async () => {
    fillDefaultTree();
    modalChoices.mockImplementation((_msg, ...actions) => Promise.resolve(actions[0]));
    const { ctx, tasks, scheduler } = makeCtx({ confirmOverwrite: true });

    await download(ctx);

    expect(modalChoices).toHaveBeenCalledTimes(1);
    const [message, transferLabel, reviewLabel] = modalChoices.mock.calls[0];
    expect(message).toContain('1 new');
    expect(message).toContain('1 will be overwritten');
    expect(message).toContain('1 identical (re-downloaded)');
    expect(transferLabel).toBe('Overwrite 1 & Download');
    expect(reviewLabel).toBe('Review in Compare View');
    expect(tasks.length).toBe(3); // newr + mod + same (identical re-transferred)
    expect(scheduler.run).toHaveBeenCalledTimes(1);
  });

  test('skipUnmodified on: identical files dropped from the transfer set', async () => {
    fillDefaultTree();
    modalChoices.mockImplementation((_msg, ...actions) => Promise.resolve(actions[0]));
    const { ctx, tasks } = makeCtx({ confirmOverwrite: true, skipUnmodified: true });

    await download(ctx);

    expect(modalChoices.mock.calls[0][0]).toContain('1 identical (skipped)');
    expect(tasks.length).toBe(2); // newr + mod only
  });

  test('skipUnmodified alone stages silently: no modal, no toast, skip applied', async () => {
    fillDefaultTree();
    const { ctx, tasks } = makeCtx({ skipUnmodified: true });

    await download(ctx);

    expect(modalChoices).not.toHaveBeenCalled();
    expect(infoToast).not.toHaveBeenCalled();
    expect(tasks.length).toBe(2);
  });

  test('Review: result handed to the compare view, transfer aborted', async () => {
    fillDefaultTree();
    modalChoices.mockResolvedValue('Review in Compare View');
    const { ctx, tasks, scheduler } = makeCtx({ confirmOverwrite: true });

    await download(ctx);

    expect(setResult).toHaveBeenCalledTimes(1);
    const result = setResult.mock.calls[0][0];
    expect(result.origin).toEqual({ kind: 'folder', root: '/local/folder' });
    expect(result.entries.length).toBe(2); // newr + mod; identical not representable
    expect(tasks.length).toBe(0);
    expect(scheduler.run).not.toHaveBeenCalled();
  });

  test('Cancel: nothing transferred', async () => {
    fillDefaultTree();
    modalChoices.mockResolvedValue(undefined);
    const { ctx, tasks } = makeCtx({ confirmOverwrite: true });

    await download(ctx);

    expect(tasks.length).toBe(0);
  });

  test('zero-overwrite fast path: creates only — no modal, passive toast, proceeds', async () => {
    // no local side at all — the destination folder doesn't exist yet
    fillFs({
      remote: { folder: { newr: file('new remote') } },
    });
    const { ctx, tasks } = makeCtx({ confirmOverwrite: true });

    await download(ctx);

    expect(modalChoices).not.toHaveBeenCalled();
    expect(infoToast).toHaveBeenCalledTimes(1);
    expect(tasks.length).toBe(1);
  });

  test('corrected fast path: identical>0 with skipUnmodified off still shows the modal', async () => {
    fillFs({
      remote: { folder: { same: file('unchanged') } },
      local: { folder: { same: file('unchanged') } },
    });
    modalChoices.mockImplementation((_msg, ...actions) => Promise.resolve(actions[0]));
    const { ctx, tasks } = makeCtx({ confirmOverwrite: true });

    await download(ctx);

    // the identical file would be silently re-transferred (data-loss path on
    // FTP) — the modal must appear even though nothing is classified overwrite
    expect(modalChoices).toHaveBeenCalledTimes(1);
    expect(modalChoices.mock.calls[0][1]).toBe('Download'); // no overwrites in label
    expect(tasks.length).toBe(1);
  });

  test('both flags off: no staging walk, no extra source/destination calls', async () => {
    fillDefaultTree();
    const lstatSpy = jest.spyOn(localFs, 'lstat');
    const listSpy = jest.spyOn(localFs, 'list');
    const { ctx, tasks } = makeCtx();

    await download(ctx);

    expect(progress).not.toHaveBeenCalled();
    expect(modalChoices).not.toHaveBeenCalled();
    // every stat/list touches the SOURCE side only — the destination is never
    // probed (localFs.list lstats its own entries internally; that's the
    // pre-existing walk, not an extra call)
    const lstatPaths = lstatSpy.mock.calls.map(c => c[0]);
    lstatPaths.forEach(p => expect(p).toMatch(/^\/remote/));
    listSpy.mock.calls.forEach(c => expect(c[0]).toMatch(/^\/remote/));
    // and the source root is stat-ed exactly once (transfer()'s own) — no
    // staging probe ran
    expect(lstatPaths.filter(p => p === '/remote/folder').length).toBe(1);
    expect(tasks.length).toBe(3);
    lstatSpy.mockRestore();
    listSpy.mockRestore();
  });

  test('cancelled walk: partial plan discarded, nothing transferred, no modal', async () => {
    fillDefaultTree();
    progress.mockImplementation((_title, task) => task(() => undefined, () => true));
    const { ctx, tasks } = makeCtx({ confirmOverwrite: true });

    await download(ctx);

    expect(modalChoices).not.toHaveBeenCalled();
    expect(tasks.length).toBe(0);
  });

  test('multi-profile flow: Skip This Profile instead of Review; Cancel throws to stop the loop', async () => {
    fillDefaultTree();
    modalChoices.mockResolvedValue('Skip This Profile');
    const { ctx, tasks } = makeCtx({ confirmOverwrite: true });

    await download(ctx, { _multiProfileFlow: true });

    expect(modalChoices.mock.calls[0].slice(1)).toEqual([
      'Overwrite 1 & Download',
      'Skip This Profile',
    ]);
    expect(tasks.length).toBe(0);

    modalChoices.mockResolvedValue(undefined); // built-in Cancel = cancel remaining
    const second = makeCtx({ confirmOverwrite: true });
    await expect(download(second.ctx, { _multiProfileFlow: true })).rejects.toBeInstanceOf(
      StagedTransferCancelledError
    );
  });
});

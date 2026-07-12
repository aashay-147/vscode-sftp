// Feature 2 — Upload/Download overwrite confirmation.
// Exercises the confirmation gate in `transferWithType` (single file) and
// `transferFolder` (one batched prompt), plus the zero-round-trip default and
// the Sync scope-exclusion. `../../host` is fully mocked so the modal return
// value is controllable and `getOpenTextDocuments` is inert.

jest.mock('fs');
// Keep the real host module (logger/ext load it transitively at import time),
// overriding only the two functions this feature touches.
jest.mock('../../../host', () => ({
  ...jest.requireActual('../../../host'),
  getOpenTextDocuments: jest.fn(() => []),
  showConfirmMessageModal: jest.fn(),
}));

import { vol } from 'memfs';
import * as fs from 'fs';
import * as path from 'path';
import { transfer, sync, TransferDirection } from '../transfer';
import localFs from '../../../core/localFs';
import TransferTask from '../../../core/transferTask';
import { showConfirmMessageModal } from '../../../host';

const modal = showConfirmMessageModal as jest.Mock;

const file = (c, time = 0) => ({
  $$type: 'file',
  content: c,
  mtime: new Date(new Date().getTime() + time * 1000),
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

async function runTransfer(opts: {
  src: string;
  target: string;
  direction?: TransferDirection;
  transferOption?: object;
}) {
  const tasks: TransferTask[] = [];
  await transfer(
    {
      srcFsPath: opts.src,
      srcFs: localFs,
      targetFsPath: opts.target,
      targetFs: localFs,
      transferDirection: opts.direction || TransferDirection.LOCAL_TO_REMOTE,
      transferOption: { perserveTargetMode: false, ...(opts.transferOption || {}) } as any,
    },
    t => tasks.push(t)
  );
  return tasks;
}

describe('overwrite confirmation (Feature 2)', () => {
  beforeEach(() => {
    modal.mockReset();
  });
  afterEach(() => {
    vol.reset();
  });

  test('off: destination is never stat-ed, task collected (zero round-trip)', async () => {
    fillFs({ local: { a: file('a') }, remote: { a: file('$a') } });
    const lstatSpy = jest.spyOn(localFs, 'lstat');

    const tasks = await runTransfer({
      src: '/local/a',
      target: '/remote/a',
      transferOption: { confirmOverwrite: false },
    });

    expect(tasks.length).toBe(1);
    expect(modal).not.toHaveBeenCalled();
    const lstatPaths = lstatSpy.mock.calls.map(c => c[0]);
    expect(lstatPaths).toContain('/local/a'); // source is stat-ed by transfer()
    expect(lstatPaths).not.toContain('/remote/a'); // destination is not
    lstatSpy.mockRestore();
  });

  test('on + destination exists + accepted: task collected', async () => {
    fillFs({ local: { a: file('a') }, remote: { a: file('$a') } });
    modal.mockResolvedValue(true);

    const tasks = await runTransfer({
      src: '/local/a',
      target: '/remote/a',
      transferOption: { confirmOverwrite: true },
    });

    expect(modal).toHaveBeenCalledTimes(1);
    expect(modal.mock.calls[0][0]).toContain('/remote/a');
    expect(tasks.length).toBe(1);
  });

  test('on + destination exists + declined: task NOT collected', async () => {
    fillFs({ local: { a: file('a') }, remote: { a: file('$a') } });
    modal.mockResolvedValue(false);

    const tasks = await runTransfer({
      src: '/local/a',
      target: '/remote/a',
      transferOption: { confirmOverwrite: true },
    });

    expect(modal).toHaveBeenCalledTimes(1);
    expect(tasks.length).toBe(0);
  });

  test('on + destination absent: no prompt, task collected', async () => {
    fillFs({ local: { a: file('a') } }); // no /remote/a
    modal.mockResolvedValue(true);

    const tasks = await runTransfer({
      src: '/local/a',
      target: '/remote/a',
      transferOption: { confirmOverwrite: true },
    });

    expect(modal).not.toHaveBeenCalled();
    expect(tasks.length).toBe(1);
  });

  test('folder + accepted: exactly ONE prompt, every file collected, no per-file prompts', async () => {
    fillFs({
      local: { folder: { a: file('a'), b: file('b'), sub: { c: file('c') } } },
      remote: { folder: { a: file('$a'), b: file('$b'), sub: { c: file('$c') } } },
    });
    modal.mockResolvedValue(true);

    const tasks = await runTransfer({
      src: '/local/folder',
      target: '/remote/folder',
      transferOption: { confirmOverwrite: true },
    });

    expect(modal).toHaveBeenCalledTimes(1); // one batched prompt for the whole walk
    expect(tasks.length).toBe(3);
  });

  test('folder + declined: whole folder skipped, nothing collected', async () => {
    fillFs({
      local: { folder: { a: file('a'), b: file('b'), sub: { c: file('c') } } },
      remote: { folder: { a: file('$a'), b: file('$b'), sub: { c: file('$c') } } },
    });
    modal.mockResolvedValue(false);

    const tasks = await runTransfer({
      src: '/local/folder',
      target: '/remote/folder',
      transferOption: { confirmOverwrite: true },
    });

    expect(modal).toHaveBeenCalledTimes(1);
    expect(tasks.length).toBe(0);
  });

  test('Sync path never prompts even with confirmOverwrite on (scope exclusion)', async () => {
    // Modified file present on both sides — the overwrite case. Sync routes it
    // through transferFile (no gate), so no prompt regardless of the flag.
    fillFs({ local: { a: file('a', 2) }, remote: { a: file('$a') } });
    modal.mockResolvedValue(true);

    const tasks: TransferTask[] = [];
    await sync(
      {
        srcFsPath: '/local',
        srcFs: localFs,
        targetFsPath: '/remote',
        targetFs: localFs,
        transferDirection: TransferDirection.LOCAL_TO_REMOTE,
        transferOption: {
          confirmOverwrite: true,
          delete: false,
          perserveTargetMode: false,
        } as any,
      },
      t => tasks.push(t)
    );

    expect(modal).not.toHaveBeenCalled();
    expect(tasks.length).toBe(1);
  });
});

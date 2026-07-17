// Feature 4 — bounded walk: collectFiles keeps at most `listLimit` directory
// reads in flight per side, releases the slot before recursing (no deadlock on
// deep trees), and releases it when list() throws.

jest.mock('vscode', () => {
  const catchAll = jest.requireActual('../../../__mocks__/vscode');
  return new Proxy(
    { Uri: class Uri {} },
    { get: (target, key) => (key in target ? target[key] : catchAll[key]) }
  );
});
jest.mock('../../app', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../createFileHandler', () => ({
  __esModule: true,
  // compare.ts calls createFileHandler() at module load — return an inert handler
  default: () => jest.fn(async () => undefined),
  handleCtxFromUri: jest.fn(),
}));

import { FileEntry, FileType } from '../../core';
import { collectFiles, WalkLimit } from '../compare';

const EPOCH = 1500000000000;

function dirEntry(fspath: string): FileEntry {
  return {
    fspath,
    name: fspath.split('/').pop()!,
    type: FileType.Directory,
    mode: 0o755,
    size: 0,
    mtime: EPOCH,
    atime: EPOCH,
  };
}

function fileEntry(fspath: string): FileEntry {
  return {
    fspath,
    name: fspath.split('/').pop()!,
    type: FileType.File,
    mode: 0o644,
    size: 1,
    mtime: EPOCH,
    atime: EPOCH,
  };
}

// A fake fs serving a canned tree, recording how many list() calls overlap.
function makeTrackedFs(tree: { [dir: string]: FileEntry[] }) {
  let inFlight = 0;
  let maxInFlight = 0;
  const fs: any = {
    list: jest.fn(async (dir: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // yield so sibling list() calls can pile up if nothing bounds them
      await new Promise(resolve => setImmediate(resolve));
      inFlight -= 1;
      if (!(dir in tree)) {
        throw new Error('ENOENT');
      }
      return tree[dir];
    }),
  };
  return { fs, maxInFlight: () => maxInFlight };
}

const control = { isCancelled: () => false };

describe('collectFiles with WalkLimit (Feature 4)', () => {
  test('in-flight list() calls never exceed the limit', async () => {
    const tree: { [dir: string]: FileEntry[] } = {
      '/root': [1, 2, 3, 4, 5, 6].map(n => dirEntry(`/root/d${n}`)),
    };
    [1, 2, 3, 4, 5, 6].forEach(n => {
      tree[`/root/d${n}`] = [fileEntry(`/root/d${n}/f.txt`)];
    });
    const { fs, maxInFlight } = makeTrackedFs(tree);

    const out = new Map<string, FileEntry>();
    await collectFiles(fs, '/root', '/root', null, out, {
      ...control,
      listLimit: new WalkLimit(2),
    });

    expect(maxInFlight()).toBeLessThanOrEqual(2);
    expect(out.size).toBe(6);
  });

  test('unbounded walk actually overlaps (guard that the fixture can detect it)', async () => {
    const tree: { [dir: string]: FileEntry[] } = {
      '/root': [1, 2, 3, 4, 5, 6].map(n => dirEntry(`/root/d${n}`)),
    };
    [1, 2, 3, 4, 5, 6].forEach(n => {
      tree[`/root/d${n}`] = [fileEntry(`/root/d${n}/f.txt`)];
    });
    const { fs, maxInFlight } = makeTrackedFs(tree);

    const out = new Map<string, FileEntry>();
    await collectFiles(fs, '/root', '/root', null, out, control);

    expect(maxInFlight()).toBeGreaterThan(2);
  });

  test('limit 1 walks a deep nested tree to completion — no deadlock', async () => {
    const tree: { [dir: string]: FileEntry[] } = {
      '/root': [dirEntry('/root/a')],
      '/root/a': [dirEntry('/root/a/b')],
      '/root/a/b': [dirEntry('/root/a/b/c')],
      '/root/a/b/c': [fileEntry('/root/a/b/c/deep.txt')],
    };
    const { fs } = makeTrackedFs(tree);

    const out = new Map<string, FileEntry>();
    await collectFiles(fs, '/root', '/root', null, out, {
      ...control,
      listLimit: new WalkLimit(1),
    });

    expect(out.size).toBe(1);
    expect(out.has('a/b/c/deep.txt')).toBe(true);
  });

  test('a throwing list() releases its slot', async () => {
    const { fs } = makeTrackedFs({}); // every dir throws ENOENT
    const limit = new WalkLimit(1);

    const out = new Map<string, FileEntry>();
    await collectFiles(fs, '/root', '/gone', null, out, { ...control, listLimit: limit });
    expect(out.size).toBe(0);

    // the slot must be free again — a second walk on the same limit completes
    const good = makeTrackedFs({ '/root': [fileEntry('/root/ok.txt')] });
    await collectFiles(good.fs, '/root', '/root', null, out, {
      ...control,
      listLimit: limit,
    });
    expect(out.has('ok.txt')).toBe(true);
  });
});

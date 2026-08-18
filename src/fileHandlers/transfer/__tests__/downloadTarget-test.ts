// Feature 9 — localDownloadPath mapping module. Covers base resolution,
// boundary-safe containment, the inverse mapping, and resolveEffectiveTarget's
// direction × under-base matrix (including the no-flag/no-base structural
// no-ops and idempotency).

jest.mock('vscode', () => {
  // real Uri semantics (vscode.Uri is built on vscode-uri) + the inert
  // catch-all for everything else the transitive imports touch
  const catchAll = jest.requireActual('../../../../__mocks__/vscode');
  const URI = require('vscode-uri').default;
  return new Proxy(
    { Uri: URI },
    { get: (target, key) => (key in target ? target[key] : catchAll[key]) }
  );
});

import * as os from 'os';
import * as path from 'path';
import { Uri } from 'vscode';
import { TransferDirection, UResource } from '../../../core';
import { isPathUnder, resolveLocalDownloadPathBase } from '../../../helper';
import {
  getDownloadPathBase,
  isUnderDownloadPath,
  resolveEffectiveTarget,
  resolveRemoteFsPathFromDownloadPath,
} from '../downloadTarget';
import { FileHandlerContext } from '../../createFileHandler';

const BASE_DIR = path.join(path.sep, 'workspace', 'project');
const REMOTE_PATH = '/var/www';

function createCtx(options: {
  localDownloadPath?: string;
  localFsPath?: string;
}): FileHandlerContext {
  const localFsPath = options.localFsPath || path.join(BASE_DIR, 'src', 'a.txt');
  const target = UResource.from(Uri.file(localFsPath), {
    localBasePath: BASE_DIR,
    remoteBasePath: REMOTE_PATH,
    remoteId: 1,
    remote: { host: 'example.com', port: 22 },
  });
  return {
    target,
    config: {
      remotePath: REMOTE_PATH,
      localDownloadPath: options.localDownloadPath,
      host: 'example.com',
      port: 22,
    },
    fileService: {
      id: 1,
      baseDir: BASE_DIR,
    },
  } as any;
}

describe('resolveLocalDownloadPathBase', () => {
  test('unset returns undefined', () => {
    expect(resolveLocalDownloadPathBase(undefined, BASE_DIR)).toBeUndefined();
    expect(resolveLocalDownloadPathBase('', BASE_DIR)).toBeUndefined();
  });

  test('relative path joins onto baseDir', () => {
    expect(resolveLocalDownloadPathBase('./_downloads', BASE_DIR)).toEqual(
      path.join(BASE_DIR, '_downloads')
    );
  });

  test('absolute path is honored as-is', () => {
    const absolute = path.join(path.sep, 'tmp', 'dl');
    expect(resolveLocalDownloadPathBase(absolute, BASE_DIR)).toEqual(absolute);
  });

  test('~/ resolves against the home dir', () => {
    expect(resolveLocalDownloadPathBase('~/dl', BASE_DIR)).toEqual(
      path.join(os.homedir(), 'dl')
    );
  });
});

describe('isPathUnder', () => {
  const base = path.join(BASE_DIR, '_downloads');

  test('nested path is under', () => {
    expect(isPathUnder(base, path.join(base, 'src', 'a.txt'))).toBe(true);
  });

  test('the base itself is under (exact match)', () => {
    expect(isPathUnder(base, base)).toBe(true);
  });

  test('outside path is not under', () => {
    expect(isPathUnder(base, path.join(BASE_DIR, 'src', 'a.txt'))).toBe(false);
  });

  test('parent of the base is not under', () => {
    expect(isPathUnder(base, BASE_DIR)).toBe(false);
  });

  test('sibling with the base as a name prefix is not under', () => {
    expect(isPathUnder(base, path.join(BASE_DIR, '_downloadsX', 'a.txt'))).toBe(false);
  });
});

describe('isUnderDownloadPath / getDownloadPathBase', () => {
  test('no localDownloadPath -> no base, nothing is under it', () => {
    const ctx = createCtx({});
    expect(getDownloadPathBase(ctx)).toBeUndefined();
    expect(isUnderDownloadPath(ctx, path.join(BASE_DIR, '_downloads', 'a.txt'))).toBe(false);
  });

  test('mirror file is under the resolved base', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads' });
    expect(getDownloadPathBase(ctx)).toEqual(path.join(BASE_DIR, '_downloads'));
    expect(isUnderDownloadPath(ctx, path.join(BASE_DIR, '_downloads', 'a.txt'))).toBe(true);
    expect(isUnderDownloadPath(ctx, path.join(BASE_DIR, 'src', 'a.txt'))).toBe(false);
  });
});

describe('resolveRemoteFsPathFromDownloadPath (inverse mapping)', () => {
  test('mirror file maps to the true remote path', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads' });
    expect(
      resolveRemoteFsPathFromDownloadPath(
        ctx,
        path.join(BASE_DIR, '_downloads', 'src', 'a.txt')
      )
    ).toEqual('/var/www/src/a.txt');
  });

  test('the base itself maps to remotePath', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads' });
    expect(
      resolveRemoteFsPathFromDownloadPath(ctx, path.join(BASE_DIR, '_downloads'))
    ).toEqual('/var/www');
  });

  test('path outside the base returns null', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads' });
    expect(
      resolveRemoteFsPathFromDownloadPath(ctx, path.join(BASE_DIR, 'src', 'a.txt'))
    ).toBeNull();
  });

  test('no base configured returns null', () => {
    const ctx = createCtx({});
    expect(
      resolveRemoteFsPathFromDownloadPath(ctx, path.join(BASE_DIR, '_downloads', 'a.txt'))
    ).toBeNull();
  });
});

describe('resolveEffectiveTarget', () => {
  const MIRROR_LOCAL = path.join(BASE_DIR, '_downloads', 'src', 'a.txt');
  const WORKSPACE_LOCAL = path.join(BASE_DIR, 'src', 'a.txt');

  test('no flag is a structural no-op (same object)', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads' });
    expect(resolveEffectiveTarget(ctx, {}, TransferDirection.REMOTE_TO_LOCAL)).toBe(ctx.target);
  });

  test('no configured base is a structural no-op (same object)', () => {
    const ctx = createCtx({});
    expect(
      resolveEffectiveTarget(
        ctx,
        { useLocalDownloadPath: true },
        TransferDirection.REMOTE_TO_LOCAL
      )
    ).toBe(ctx.target);
  });

  test('download, local outside base: remote literal, local forward-mapped', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads', localFsPath: WORKSPACE_LOCAL });
    const target = resolveEffectiveTarget(
      ctx,
      { useLocalDownloadPath: true },
      TransferDirection.REMOTE_TO_LOCAL
    );
    expect(target.remoteFsPath).toEqual('/var/www/src/a.txt');
    expect(target.localFsPath).toEqual(MIRROR_LOCAL);
  });

  test('download of the remote root lands in the base itself', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads', localFsPath: BASE_DIR });
    const target = resolveEffectiveTarget(
      ctx,
      { useLocalDownloadPath: true },
      TransferDirection.REMOTE_TO_LOCAL
    );
    expect(target.remoteFsPath).toEqual('/var/www');
    expect(target.localFsPath).toEqual(path.join(BASE_DIR, '_downloads'));
  });

  test('download, local under base (re-download): local literal, remote inverse-mapped', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads', localFsPath: MIRROR_LOCAL });
    const target = resolveEffectiveTarget(
      ctx,
      { useLocalDownloadPath: true },
      TransferDirection.REMOTE_TO_LOCAL
    );
    expect(target.localFsPath).toEqual(MIRROR_LOCAL);
    expect(target.remoteFsPath).toEqual('/var/www/src/a.txt');
  });

  test('upload, local under base: local literal, remote inverse-mapped', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads', localFsPath: MIRROR_LOCAL });
    const target = resolveEffectiveTarget(
      ctx,
      { useLocalDownloadPath: true },
      TransferDirection.LOCAL_TO_REMOTE
    );
    expect(target.localFsPath).toEqual(MIRROR_LOCAL);
    // NOT /var/www/_downloads/src/a.txt
    expect(target.remoteFsPath).toEqual('/var/www/src/a.txt');
  });

  test('upload, local outside base: unchanged (same object)', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads', localFsPath: WORKSPACE_LOCAL });
    expect(
      resolveEffectiveTarget(
        ctx,
        { useLocalDownloadPath: true },
        TransferDirection.LOCAL_TO_REMOTE
      )
    ).toBe(ctx.target);
  });

  test('idempotent: remapping a remapped download target changes nothing', () => {
    const ctx = createCtx({ localDownloadPath: '_downloads', localFsPath: WORKSPACE_LOCAL });
    const once = resolveEffectiveTarget(
      ctx,
      { useLocalDownloadPath: true },
      TransferDirection.REMOTE_TO_LOCAL
    );
    const twice = resolveEffectiveTarget(
      { ...ctx, target: once } as any,
      { useLocalDownloadPath: true },
      TransferDirection.REMOTE_TO_LOCAL
    );
    expect(twice.localFsPath).toEqual(once.localFsPath);
    expect(twice.remoteFsPath).toEqual(once.remoteFsPath);
  });
});

// Features 2+3 - aggregated multi-file staging (U3.6): one counts modal per
// service, flags-off fan-out preserved byte-for-byte, skipUnmodified dropping
// identical selections, folders delegated to their own staged flow, Review
// with a files origin.

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
  // compare.ts calls createFileHandler() at module load - return an inert handler
  default: () => jest.fn(async () => undefined),
  handleCtxFromUri: jest.fn(),
}));
jest.mock('../transfer', () => ({
  uploadFile: jest.fn(async () => undefined),
  downloadFile: jest.fn(async () => undefined),
}));
jest.mock('../../host', () => ({
  ...jest.requireActual('../../host'),
  showModalChoices: jest.fn(),
  showInformationMessage: jest.fn(),
  executeCommand: jest.fn(),
  // run the batch inline - the vscode catch-all mock's withProgress never
  // settles, so the real implementation would hang the fan-out paths
  showTransferProgress: jest.fn((_title, task) =>
    task(() => undefined, () => undefined)
  ),
}));

import app from '../../app';
import { FileType, TransferDirection } from '../../core';
import { showModalChoices } from '../../host';
import { handleCtxFromUri } from '../createFileHandler';
import { uploadFile } from '../transfer';
import { transferSelectedFiles } from '../multiFileTransfer';

const modalChoices = showModalChoices as jest.Mock;
const ctxFromUri = handleCtxFromUri as jest.Mock;
const upload = uploadFile as jest.Mock;
const setResult = (app as any).compareExplorer.setResult as jest.Mock;

const EPOCH = 1500000000000;
const stat = (size: number, mtimeOffsetSeconds = 0, type = FileType.File) => ({
  type,
  size,
  mtime: EPOCH + mtimeOffsetSeconds * 1000,
  atime: EPOCH,
});

// A fake service whose local/remote filesystems serve canned lstat results.
function makeService(name: string, configOverrides: object = {}) {
  const localStats: { [x: string]: any } = {};
  const remoteStats: { [x: string]: any } = {};
  const fsFrom = stats => ({
    lstat: async (fsPath: string) => {
      if (!stats[fsPath]) {
        throw new Error('ENOENT');
      }
      return stats[fsPath];
    },
  });
  const fileService: any = {
    name,
    baseDir: '/local',
    getLocalFileSystem: () => fsFrom(localStats),
    getRemoteFileSystem: async () => fsFrom(remoteStats),
  };
  const config: any = {
    protocol: 'sftp',
    host: 'example.com',
    remotePath: '/remote',
    ignore: null,
    ...configOverrides,
  };
  const addFile = (rel: string, local: any, remote: any) => {
    const localFsPath = `/local/${rel}`;
    const remoteFsPath = `/remote/${rel}`;
    if (local) {
      localStats[localFsPath] = local;
    }
    if (remote) {
      remoteStats[remoteFsPath] = remote;
    }
    const uri: any = { $$rel: rel, toString: () => `file://${localFsPath}` };
    ctxFromUri.mockImplementation(u => u.$$ctx);
    uri.$$ctx = {
      fileService,
      config,
      target: { localFsPath, remoteFsPath, localUri: { toString: () => `file://${localFsPath}` } },
    };
    return uri;
  };
  return { fileService, config, addFile };
}

describe('transferSelectedFiles (aggregated staging, U3.6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('flags on: one modal for the batch; skipUnmodified drops identical selections', async () => {
    const service = makeService('s1', { confirmOverwrite: true, skipUnmodified: true });
    const modified = service.addFile('mod.txt', stat(10), stat(20));
    const identical = service.addFile('same.txt', stat(5), stat(5));
    modalChoices.mockImplementation((_msg, ...actions) => Promise.resolve(actions[0]));

    await transferSelectedFiles([modified, identical], TransferDirection.LOCAL_TO_REMOTE, {
      ignore: null,
    });

    expect(modalChoices).toHaveBeenCalledTimes(1);
    const [message, transferLabel] = modalChoices.mock.calls[0];
    expect(message).toContain('1 will be overwritten');
    expect(message).toContain('1 identical (skipped)');
    expect(transferLabel).toBe('Overwrite 1 & Upload');
    // only the modified file transfers, with the batch-covered overrides
    expect(upload).toHaveBeenCalledTimes(1);
    const [ctx, option] = upload.mock.calls[0];
    expect(ctx.target.localFsPath).toBe('/local/mod.txt');
    expect(option.confirmOverwrite).toBe(false);
    expect(option.skipUnmodified).toBe(false);
  });

  test('flags off: plain per-uri fan-out, no modal, no classification', async () => {
    const service = makeService('s1');
    const a = service.addFile('a.txt', stat(1), stat(2));
    const b = service.addFile('b.txt', stat(1), stat(1));

    await transferSelectedFiles([a, b], TransferDirection.LOCAL_TO_REMOTE, { ignore: null });

    expect(modalChoices).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(2);
    // options passed through untouched - no confirmOverwrite override injected
    expect(upload.mock.calls[0][1]).toEqual({ ignore: null });
  });

  test('two services: one modal each, sequential; Cancel skips only that service', async () => {
    const s1 = makeService('s1', { confirmOverwrite: true });
    const s2 = makeService('s2', { confirmOverwrite: true });
    const f1 = s1.addFile('one.txt', stat(1), stat(2));
    const f2 = s2.addFile('two.txt', stat(3), stat(4));
    // both files come from different services - re-register both impls since
    // addFile overwrites the shared mockImplementation
    ctxFromUri.mockImplementation(u => u.$$ctx);
    modalChoices.mockResolvedValue(undefined); // Cancel both

    await transferSelectedFiles([f1, f2], TransferDirection.LOCAL_TO_REMOTE, { ignore: null });

    expect(modalChoices).toHaveBeenCalledTimes(2);
    expect(upload).not.toHaveBeenCalled();
  });

  test('Review: files origin so Refresh re-checks the selection, not a folder walk', async () => {
    const service = makeService('s1', { confirmOverwrite: true });
    const modified = service.addFile('mod.txt', stat(10), stat(20));
    modalChoices.mockResolvedValue('Review in Compare View');

    await transferSelectedFiles([modified], TransferDirection.LOCAL_TO_REMOTE, { ignore: null });

    expect(upload).not.toHaveBeenCalled();
    expect(setResult).toHaveBeenCalledTimes(1);
    const result = setResult.mock.calls[0][0];
    expect(result.origin.kind).toBe('files');
    expect(result.origin.uris).toEqual(['file:///local/mod.txt']);
    expect(result.entries.length).toBe(1);
  });

  test('folder in the selection runs its own staged flow via the ordinary handler', async () => {
    const service = makeService('s1', { confirmOverwrite: true });
    const folder = service.addFile('dir', stat(0, 0, FileType.Directory), null);
    const modified = service.addFile('mod.txt', stat(10), stat(20));
    modalChoices.mockImplementation((_msg, ...actions) => Promise.resolve(actions[0]));

    await transferSelectedFiles([folder, modified], TransferDirection.LOCAL_TO_REMOTE, {
      ignore: null,
    });

    expect(upload).toHaveBeenCalledTimes(2);
    // the folder call keeps the base option - its own staged flow (inside the
    // real handler) owns confirmation, so no override is injected
    const folderCall = upload.mock.calls.find(c => c[0].target.localFsPath === '/local/dir');
    expect(folderCall![1]).toEqual({ ignore: null });
  });
});

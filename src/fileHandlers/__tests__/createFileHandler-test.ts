// Feature 2 - the call-site override mechanism (plan test 6) and the
// notifyIgnored toast gate. Force and compare-view commands rely on
// `Object.assign(invokeOption, option)` giving a call-site
// `confirmOverwrite: false` priority over the config-derived transformOption
// value; this pins that mechanism so those exemptions can't silently break.

// The shared vscode mock is a catch-all Proxy whose Symbol.hasInstance lookup
// makes `x instanceof Uri` true for ANY x, which would misroute the plain ctx
// object below into handleCtxFromUri. Give Uri a real class; everything else
// keeps the catch-all.
jest.mock('vscode', () => {
  const catchAll = jest.requireActual('../../../__mocks__/vscode');
  return new Proxy(
    { Uri: class Uri {} },
    { get: (target, key) => (key in target ? target[key] : catchAll[key]) }
  );
});
jest.mock('../../app', () => ({
  __esModule: true,
  default: { sftpBarItem: { startSpinner: jest.fn(), stopSpinner: jest.fn() } },
}));
// Break the pre-existing require cycle createFileHandler → serviceManager →
// fileWatcher → fileHandlers → createFileHandler, which only bites when this
// module is the entry point (as it is here).
jest.mock('../../modules/serviceManager', () => ({
  getFileService: jest.fn(),
}));
// Keep the real host module (logger/ext load it transitively at import time),
// overriding only the toast this test observes.
jest.mock('../../host', () => ({
  ...jest.requireActual('../../host'),
  showInformationMessage: jest.fn(),
}));

import createFileHandler from '../createFileHandler';
import { showInformationMessage } from '../../host';

const toast = showInformationMessage as jest.Mock;

const ctx: any = {
  target: { localFsPath: '/local/folder' },
  fileService: {},
  config: {},
};

function makeHandler(transformed: object) {
  const handle = jest.fn().mockResolvedValue(undefined);
  const handler = createFileHandler<any>({
    name: 'test handler',
    handle,
    transformOption() {
      return transformed;
    },
  });
  return { handle, handler };
}

describe('createFileHandler option merging (Feature 2 exemption mechanism)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('call-site confirmOverwrite: false wins over transformOption (force/compare-group never prompt)', async () => {
    const { handle, handler } = makeHandler({ confirmOverwrite: true });

    await handler(ctx, { confirmOverwrite: false });

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0].confirmOverwrite).toBe(false);
  });

  test('call-site skipUnmodified: false wins over transformOption (force/compare/implicit never stage)', async () => {
    const { handle, handler } = makeHandler({ skipUnmodified: true });

    await handler(ctx, { skipUnmodified: false });

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0].skipUnmodified).toBe(false);
  });

  test('config confirmOverwrite reaches the handler untouched when the call site is silent', async () => {
    const { handle, handler } = makeHandler({ confirmOverwrite: true });

    await handler(ctx);

    expect(handle.mock.calls[0][0].confirmOverwrite).toBe(true);
  });

  test('ignored target + notifyIgnored: toast shown, handler skipped', async () => {
    const { handle, handler } = makeHandler({ ignore: () => true });

    await handler(ctx, { notifyIgnored: true });

    expect(handle).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toContain('folder');
  });

  test('ignored target without notifyIgnored stays silent (implicit paths, sync)', async () => {
    const { handle, handler } = makeHandler({ ignore: () => true });

    await handler(ctx);

    expect(handle).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});

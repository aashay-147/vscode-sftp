// Feature 4 — PooledRemoteFs: pool size 1 hands out the raw fs (byte-identical
// default), the pool grows lazily and only under load, never past its cap,
// fd-based calls route back to the connection that opened the handle, disposal
// ends every member, and interactive passwords are asked once per pool.

jest.mock('../../app', () => ({
  __esModule: true,
  default: {
    sftpBarItem: { showMsg: jest.fn(), reset: jest.fn() },
  },
}));
jest.mock('../../host', () => ({
  ...jest.requireActual('../../host'),
  promptForPassword: jest.fn(async () => 'secret'),
}));
jest.mock('../fs', () => {
  const actual = jest.requireActual('../fs');
  const instances: any[] = [];
  let connectHook: ((instance: any, option: any, config: any) => Promise<void>) | null = null;

  class FakeSFTPFileSystem {
    pathResolver: any;
    clientOption: any;
    ended = false;
    pendingLists: Array<() => void> = [];
    connectConfig: any;
    list = jest.fn(
      () =>
        new Promise(resolve => {
          this.pendingLists.push(() => resolve([]));
        })
    );
    lstat = jest.fn(async () => ({}));
    open = jest.fn(async (path: string) => ({ path, owner: this }));
    close = jest.fn(async () => undefined);
    fstat = jest.fn(async () => ({}));

    constructor(pathResolver, option) {
      this.pathResolver = pathResolver;
      this.clientOption = option.clientOption;
      instances.push(this);
    }
    onDisconnected() {
      /* keep-alive callback unused in tests */
    }
    connect(option, config) {
      this.connectConfig = config;
      return connectHook ? connectHook(this, option, config) : Promise.resolve();
    }
    end() {
      this.ended = true;
    }
  }

  return {
    ...actual,
    SFTPFileSystem: FakeSFTPFileSystem,
    __instances: instances,
    __setConnectHook: (fn: any) => {
      connectHook = fn;
    },
  };
});

import { promptForPassword } from '../../host';
import { createRemoteIfNoneExist, removeRemoteFs } from '../remoteFs';
import { resolvePoolSize } from '../fileService';

// tslint:disable-next-line no-var-requires
const fsModule = require('../fs');
const instances: any[] = fsModule.__instances;
const setConnectHook: (fn: any) => void = fsModule.__setConnectHook;

const promptMock = promptForPassword as jest.Mock;

// unique host per test — the module-level fsTable persists across tests
let hostId = 0;
function makeOption(overrides: object = {}) {
  hostId += 1;
  return {
    protocol: 'sftp',
    host: `host-${hostId}`,
    remoteTimeOffsetInHours: 0,
    ...overrides,
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

// dispatch → connect → list all hop through microtasks, so flush before
// resolving the deferred list calls
async function drainLists() {
  await flush();
  instances.forEach(instance => {
    instance.pendingLists.forEach(resolve => resolve());
    instance.pendingLists.length = 0;
  });
}

describe('PooledRemoteFs (Feature 4)', () => {
  beforeEach(() => {
    instances.length = 0;
    setConnectHook(null);
    jest.clearAllMocks();
    promptMock.mockImplementation(async () => 'secret');
  });

  test('pool size 1 returns the raw remote fs — no facade in the default path', async () => {
    const option = makeOption();
    const fs = await createRemoteIfNoneExist(option, 1);
    expect(instances.length).toBe(1);
    expect(fs).toBe(instances[0]);
    // repeated calls reuse the same connection
    const again = await createRemoteIfNoneExist(option, 1);
    expect(again).toBe(instances[0]);
    expect(instances.length).toBe(1);
  });

  test('idle pool stays at one connection; sequential calls never grow it', async () => {
    const option = makeOption();
    const fs = await createRemoteIfNoneExist(option, 3);
    expect(fs).not.toBe(instances[0]); // facade
    await fs.lstat('/a');
    await fs.lstat('/b');
    await fs.lstat('/c');
    expect(instances.length).toBe(1);
  });

  test('concurrent load grows the pool lazily up to the cap, never past it', async () => {
    const option = makeOption();
    const fs = await createRemoteIfNoneExist(option, 3);

    const pending = ['/1', '/2', '/3', '/4', '/5'].map(dir => fs.list(dir));
    // 5 concurrent list calls, cap 3 — exactly 3 connections
    expect(instances.length).toBe(3);

    await drainLists();
    await Promise.all(pending);

    // load is gone — later sequential work reuses existing members
    await fs.lstat('/after');
    expect(instances.length).toBe(3);
  });

  test('fd affinity: close routes to the member that opened the handle', async () => {
    const option = makeOption();
    const fs = await createRemoteIfNoneExist(option, 2);

    // occupy the primary so open grows to (and lands on) a second member
    const blocked = fs.list('/busy');
    const fd = await fs.open('/file', 'w');
    expect(instances.length).toBe(2);
    expect(instances[1].open).toHaveBeenCalled();

    await fs.close(fd);
    expect(instances[1].close).toHaveBeenCalledTimes(1);
    expect(instances[0].close).not.toHaveBeenCalled();

    await drainLists();
    await blocked;
  });

  test('removeRemoteFs ends every pool member', async () => {
    const option = makeOption();
    const fs = await createRemoteIfNoneExist(option, 3);
    const pending = ['/1', '/2', '/3'].map(dir => fs.list(dir));
    expect(instances.length).toBe(3);
    await drainLists();
    await Promise.all(pending);

    removeRemoteFs(option);
    instances.forEach(instance => expect(instance.ended).toBe(true));
  });

  test('interactive password is prompted once and reused for later members', async () => {
    setConnectHook((_instance, option, config) =>
      config.askForPasswd(`[${option.host}]: Enter your password`).then(answer => {
        if (answer === undefined) {
          throw new Error('cancelled');
        }
      })
    );

    const option = makeOption();
    const fs = await createRemoteIfNoneExist(option, 3);
    expect(promptMock).toHaveBeenCalledTimes(1);

    const pending = ['/1', '/2', '/3'].map(dir => fs.list(dir));
    expect(instances.length).toBe(3);
    await drainLists();
    await Promise.all(pending);

    // members 2 and 3 connected with the cached answer — no extra prompts
    expect(promptMock).toHaveBeenCalledTimes(1);
    instances.forEach(instance => expect(instance.connectConfig).toBeDefined());
  });

});

describe('resolvePoolSize (Feature 4)', () => {
  test('defaults to 1 when maxConnections is not set', () => {
    expect(resolvePoolSize({ protocol: 'sftp', concurrency: 4 })).toBe(1);
  });

  test('capped by concurrency — more connections than workers is waste', () => {
    expect(
      resolvePoolSize({ protocol: 'sftp', maxConnections: 8, concurrency: 4 })
    ).toBe(4);
  });

  test('capped by the hard ceiling of 8', () => {
    expect(
      resolvePoolSize({ protocol: 'sftp', maxConnections: 100, concurrency: 100 })
    ).toBe(8);
  });

  test('maxConnections below concurrency wins', () => {
    expect(
      resolvePoolSize({ protocol: 'sftp', maxConnections: 3, concurrency: 8 })
    ).toBe(3);
  });

  test('non-sftp protocols are always 1', () => {
    expect(resolvePoolSize({ protocol: 'ftp', maxConnections: 8, concurrency: 8 })).toBe(1);
    expect(resolvePoolSize({ protocol: 'local', maxConnections: 8, concurrency: 8 })).toBe(1);
  });
});

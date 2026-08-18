// Feature 5 - runTransferScheduler: determinate per-operation progress over a
// collected scheduler. Gates (single-task runs and empty runs never pop a
// notification), total = collected task count, per-task increments,
// notification Cancel stops only that operation, and the paused message.

jest.mock('../../../app', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../../host', () => ({
  ...jest.requireActual('../../../host'),
  showTransferProgress: jest.fn(),
}));

import { FileService } from '../../../core';
import { showTransferProgress } from '../../../host';
import { setPaused } from '../../../ui/transferControls';
import { runTransferScheduler } from '../progress';

const progressMock = showTransferProgress as jest.Mock;

const flush = () => new Promise(resolve => setImmediate(resolve));

function makeTask(name: string, autoResolve = true) {
  let finish!: () => void;
  const started = jest.fn();
  const promise = autoResolve
    ? Promise.resolve()
    : new Promise<void>(resolve => {
        finish = resolve;
      });
  const task: any = {
    localFsPath: `/local/${name}`,
    transferType: 'upload',
    cancel: jest.fn(),
    isCancelled: () => false,
    run: () => {
      started();
      return promise;
    },
  };
  return { task, started, finish };
}

function makeScheduler(concurrency = 1) {
  return new FileService('/local', '/workspace', {} as any).createTransferScheduler(concurrency);
}

describe('runTransferScheduler (Feature 5)', () => {
  let reportMock: jest.Mock;
  let cancelCallbacks: Array<() => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    reportMock = jest.fn();
    cancelCallbacks = [];
    progressMock.mockImplementation((_title, task) =>
      task(
        update => reportMock(update),
        callback => cancelCallbacks.push(callback)
      )
    );
    setPaused(false);
  });

  test('multi-task run: one notification, total in title, per-task increments', async () => {
    const scheduler = makeScheduler(2);
    const tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
    tasks.forEach(t => scheduler.add(t.task));

    await runTransferScheduler(scheduler, "SFTP: Uploading 'folder'");

    expect(progressMock).toHaveBeenCalledTimes(1);
    expect(progressMock.mock.calls[0][0]).toBe("SFTP: Uploading 'folder' (3 files)");
    expect(reportMock).toHaveBeenCalledTimes(3);
    const updates = reportMock.mock.calls.map(call => call[0]);
    updates.forEach(update => expect(update.increment).toBeCloseTo(100 / 3));
    expect(updates[2].message).toMatch(/^3\/3 - /);
  });

  test('single task: no notification, task still runs', async () => {
    const scheduler = makeScheduler(1);
    const only = makeTask('only');
    scheduler.add(only.task);

    await runTransferScheduler(scheduler, 'SFTP: Uploading');

    expect(progressMock).not.toHaveBeenCalled();
    expect(only.started).toHaveBeenCalled();
  });

  test('empty run: resolves, no notification', async () => {
    const scheduler = makeScheduler(1);
    await runTransferScheduler(scheduler, 'SFTP: Uploading');
    expect(progressMock).not.toHaveBeenCalled();
  });

  test('notification Cancel stops this operation: queued tasks dropped, in-flight finishes', async () => {
    const scheduler = makeScheduler(1);
    const first = makeTask('first', false);
    const second = makeTask('second');
    const third = makeTask('third');
    [first, second, third].forEach(t => scheduler.add(t.task));

    const running = runTransferScheduler(scheduler, 'SFTP: Downloading');
    await flush();
    expect(cancelCallbacks.length).toBe(1);
    cancelCallbacks[0]();
    first.finish();
    await running;

    expect(second.started).not.toHaveBeenCalled();
    expect(third.started).not.toHaveBeenCalled();
  });

  test('global pause is reflected in the notification message; resume drains to completion', async () => {
    const scheduler = makeScheduler(1);
    const first = makeTask('first', false);
    const second = makeTask('second');
    scheduler.add(first.task);
    scheduler.add(second.task);

    const running = runTransferScheduler(scheduler, 'SFTP: Uploading');
    await flush();
    scheduler.pause();
    setPaused(true);
    expect(reportMock).toHaveBeenCalledWith({ message: 'Paused - 0/2' });

    first.finish();
    await flush();
    // task events keep the paused wording while paused
    expect(reportMock.mock.calls[reportMock.mock.calls.length - 1][0].message).toBe(
      'Paused - 1/2'
    );

    setPaused(false);
    scheduler.resume();
    await running;
    const finalUpdate = reportMock.mock.calls[reportMock.mock.calls.length - 1][0];
    expect(finalUpdate.message).toMatch(/^2\/2 - /);
  });
});

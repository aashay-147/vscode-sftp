// Feature 5 - TransferScheduler wrapper semantics: onTaskStart/onTaskDone
// passthroughs, pause keeps the queue / resume drains it, stop drops queued
// tasks while in-flight ones finish, and (the deactivate-clean guarantee)
// stop resolves a PAUSED run even when nothing is in flight to emit idle.

jest.mock('../../app', () => ({
  __esModule: true,
  default: {},
}));

import FileService from '../fileService';

const flush = () => new Promise(resolve => setImmediate(resolve));

function makeTask(name: string) {
  let finish!: () => void;
  const started = jest.fn();
  const promise = new Promise<void>(resolve => {
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

function makeService() {
  return new FileService('/local', '/workspace', {} as any);
}

describe('TransferScheduler wrapper (Feature 5)', () => {
  test('onTaskStart/onTaskDone passthroughs fire per task; run resolves after all', async () => {
    const scheduler = makeService().createTransferScheduler(2);
    const onStart = jest.fn();
    const onDone = jest.fn();
    scheduler.onTaskStart(onStart);
    scheduler.onTaskDone(onDone);

    const tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
    tasks.forEach(t => scheduler.add(t.task));
    const running = scheduler.run();
    await flush();
    tasks.forEach(t => t.finish());
    await running;

    expect(onStart).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(3);
    expect(onDone.mock.calls.every(call => call[0] === null)).toBe(true);
  });

  test('pause keeps the queue; resume drains it', async () => {
    const scheduler = makeService().createTransferScheduler(1);
    const first = makeTask('first');
    const second = makeTask('second');
    scheduler.add(first.task);
    scheduler.add(second.task);

    const running = scheduler.run();
    await flush();
    expect(first.started).toHaveBeenCalled();
    expect(second.started).not.toHaveBeenCalled();

    scheduler.pause();
    first.finish();
    await flush();
    // in-flight finished, but the queued task must NOT start while paused
    expect(second.started).not.toHaveBeenCalled();
    expect(scheduler.size).toBe(1);

    scheduler.resume();
    await flush();
    expect(second.started).toHaveBeenCalled();
    second.finish();
    await running;
  });

  test('stop drops queued tasks; the in-flight task runs to completion', async () => {
    const scheduler = makeService().createTransferScheduler(1);
    const first = makeTask('first');
    const second = makeTask('second');
    const third = makeTask('third');
    [first, second, third].forEach(t => scheduler.add(t.task));

    const running = scheduler.run();
    await flush();
    scheduler.stop();
    first.finish();
    await running;

    expect(second.started).not.toHaveBeenCalled();
    expect(third.started).not.toHaveBeenCalled();
  });

  test('stop while PAUSED with nothing in flight still resolves run (clean deactivate)', async () => {
    const scheduler = makeService().createTransferScheduler(1);
    const first = makeTask('first');
    const second = makeTask('second');
    scheduler.add(first.task);
    scheduler.add(second.task);

    const running = scheduler.run();
    await flush();
    scheduler.pause();
    first.finish();
    await flush();
    // paused, queue non-empty, zero in flight - no completion event will come
    scheduler.stop();
    await running;

    expect(second.started).not.toHaveBeenCalled();
  });

  test('global cancelTransferTasks stops a paused queue and cancels in-flight tasks', async () => {
    const fileService = makeService();
    const scheduler = fileService.createTransferScheduler(1);
    const first = makeTask('first');
    const second = makeTask('second');
    scheduler.add(first.task);
    scheduler.add(second.task);

    const running = scheduler.run();
    await flush();
    fileService.pauseTransferTasks();
    fileService.cancelTransferTasks();

    expect(first.task.cancel).toHaveBeenCalled();
    first.finish();
    await running;
    expect(second.started).not.toHaveBeenCalled();
    expect(fileService.isTransferring()).toBe(false);
  });
});

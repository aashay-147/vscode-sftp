// Per-operation determinate progress for scheduler-driven transfers
// (Feature 5). Wraps a collected TransferScheduler run in a cancellable
// notification with a per-file counter, and registers the operation with the
// global pause/resume status-bar control.
//
// Gating: single-task runs keep the plain status-bar spinner (nothing to
// count), and call sites on implicit paths (uploadOnSave, downloadOnOpen,
// watcher, Edit in Local) opt out entirely with `_noProgress` so background
// activity never pops a notification.

import * as path from 'path';
import { TransferScheduler, TransferTask } from '../../core';
import { showTransferProgress } from '../../host';
import {
  operationEnded,
  operationProgressed,
  operationStarted,
  progressMessage,
  TransferOperation,
} from '../../ui/transferControls';

export async function runTransferScheduler(
  scheduler: TransferScheduler,
  title: string
): Promise<void> {
  const total = scheduler.size;
  if (total <= 1) {
    return scheduler.run();
  }

  const op: TransferOperation = { done: 0, total };
  operationStarted(op);
  try {
    await showTransferProgress(`${title} (${total} files)`, (report, onCancel) => {
      op.report = report;
      // Cancel drops the queued tasks; in-flight files finish (a clean stop
      // between files, not a mid-file abort).
      onCancel(() => scheduler.stop());
      scheduler.onTaskDone((_err, task) => {
        op.done += 1;
        report({
          increment: 100 / total,
          message: progressMessage(op, path.basename((task as TransferTask).localFsPath)),
        });
        operationProgressed();
      });
      return scheduler.run();
    });
  } finally {
    operationEnded(op);
  }
}

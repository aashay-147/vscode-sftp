// Global pause/resume control for scheduler-driven transfers (Feature 5).
// A status-bar toggle appears while at least one progress-tracked operation
// (sync / folder / multi-file transfer) is running: click to pause, click
// again to resume. State is global - pausing pauses every running operation -
// and each operation's progress notification mirrors it ("Paused - 12/40").
// `sftp.cancelAllTransfer` remains the global stop.

import * as vscode from 'vscode';
import { COMMAND_TRANSFER_PAUSE, COMMAND_TRANSFER_RESUME } from '../constants';

export interface TransferOperation {
  done: number;
  total: number;
  // reporter of the operation's progress notification; used to reflect
  // pause/resume immediately instead of waiting for the next task event
  report?: (update: { message?: string }) => void;
}

const activeOperations = new Set<TransferOperation>();
let paused = false;
let statusBarItem: vscode.StatusBarItem | null = null;

function getStatusBarItem(): vscode.StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  }
  return statusBarItem;
}

function totals(): { done: number; total: number } {
  let done = 0;
  let total = 0;
  activeOperations.forEach(op => {
    done += op.done;
    total += op.total;
  });
  return { done, total };
}

export function progressCounts(op: TransferOperation): string {
  return `${op.done}/${op.total}`;
}

// message line for an operation's progress notification, honoring pause state
export function progressMessage(op: TransferOperation, detail?: string): string {
  const counts = progressCounts(op);
  if (paused) {
    return `Paused - ${counts}`;
  }
  return detail ? `${counts} - ${detail}` : counts;
}

function render() {
  const item = getStatusBarItem();
  if (activeOperations.size === 0) {
    item.hide();
    return;
  }

  const { done, total } = totals();
  if (paused) {
    item.text = `$(debug-start) SFTP: Paused - ${done}/${total}`;
    item.tooltip = 'Transfers paused - click to resume';
    item.command = COMMAND_TRANSFER_RESUME;
  } else {
    item.text = `$(debug-pause) SFTP ${done}/${total}`;
    item.tooltip = 'Click to pause transfers (in-flight files finish first)';
    item.command = COMMAND_TRANSFER_PAUSE;
  }
  item.show();
}

export function operationStarted(op: TransferOperation) {
  activeOperations.add(op);
  render();
}

export function operationProgressed() {
  render();
}

export function operationEnded(op: TransferOperation) {
  activeOperations.delete(op);
  if (activeOperations.size === 0) {
    // nothing left to resume - don't leak the paused state into the next run
    paused = false;
  }
  render();
}

export function isPaused(): boolean {
  return paused;
}

export function setPaused(value: boolean) {
  paused = value;
  activeOperations.forEach(op => {
    if (op.report) {
      op.report({ message: progressMessage(op) });
    }
  });
  render();
}

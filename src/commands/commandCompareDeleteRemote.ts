import { Uri } from 'vscode';
import { COMMAND_COMPARE_DELETE_REMOTE, COMMAND_COMPARE_REFRESH } from '../constants';
import { removeRemote } from '../fileHandlers';
import { executeCommand, showConfirmMessageModal } from '../host';
import { checkCommand } from './abstract/createCommand';
import { canDeleteCompareRemote } from './compareNode';

export default checkCommand({
  id: COMMAND_COMPARE_DELETE_REMOTE,

  async handleCommand(node) {
    if (!node || node.kind !== 'entry' || !canDeleteCompareRemote(node.entry.status)) {
      return;
    }

    const entry = node.entry;
    const confirmed = await showConfirmMessageModal(
      `Delete remote file '${entry.relPath}'? This cannot be undone.`,
      'Delete'
    );
    if (!confirmed) {
      return;
    }

    try {
      await removeRemote(Uri.file(entry.localFsPath));
    } finally {
      await executeCommand(COMMAND_COMPARE_REFRESH);
    }
  },
});

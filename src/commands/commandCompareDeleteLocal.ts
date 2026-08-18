import { COMMAND_COMPARE_DELETE_LOCAL, COMMAND_COMPARE_REFRESH } from '../constants';
import { removeLocal } from '../fileHandlers';
import { executeCommand, showConfirmMessageModal } from '../host';
import { checkCommand } from './abstract/createCommand';
import { canDeleteCompareLocal } from './compareNode';
import { ctxFromCompareEntry } from './shared';

export default checkCommand({
  id: COMMAND_COMPARE_DELETE_LOCAL,

  async handleCommand(node) {
    if (!node || node.kind !== 'entry' || !canDeleteCompareLocal(node.entry.status)) {
      return;
    }

    const entry = node.entry;
    const confirmed = await showConfirmMessageModal(
      `Delete local file '${entry.relPath}'? This cannot be undone.`,
      'Delete'
    );
    if (!confirmed) {
      return;
    }

    try {
      await removeLocal(ctxFromCompareEntry(entry));
    } finally {
      await executeCommand(COMMAND_COMPARE_REFRESH);
    }
  },
});

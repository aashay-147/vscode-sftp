import { COMMAND_COMPARE_GROUP_DELETE_LOCAL } from '../constants';
import { removeLocal } from '../fileHandlers';
import { showConfirmMessageModal } from '../host';
import { checkCommand } from './abstract/createCommand';
import { compareGroupEntries, runCompareGroup } from './shared';

// Mirror-delete a New-Local group: these files exist only locally, so making
// local match the remote means removing them. Destructive and irreversible —
// gated behind a modal confirm that names the count.
export default checkCommand({
  id: COMMAND_COMPARE_GROUP_DELETE_LOCAL,

  async handleCommand(node) {
    const entries = compareGroupEntries(node);
    if (!entries.length) {
      return;
    }

    const confirmed = await showConfirmMessageModal(
      `Delete ${entries.length} LOCAL file(s)? This cannot be undone.`,
      'Delete'
    );
    if (!confirmed) {
      return;
    }

    await runCompareGroup(entries, ctx => removeLocal(ctx));
  },
});

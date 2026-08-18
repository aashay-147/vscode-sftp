import { COMMAND_COMPARE_GROUP_DELETE_REMOTE } from '../constants';
import { removeRemote } from '../fileHandlers';
import { showConfirmMessageModal } from '../host';
import { checkCommand } from './abstract/createCommand';
import { compareGroupEntries, runCompareGroup } from './shared';

// Mirror-delete a New-Remote group: these files exist only on the remote, so
// making the remote match local means removing them. Destructive and
// irreversible — gated behind a modal confirm that names the count.
export default checkCommand({
  id: COMMAND_COMPARE_GROUP_DELETE_REMOTE,

  async handleCommand(node) {
    const entries = compareGroupEntries(node);
    if (!entries.length) {
      return;
    }

    const confirmed = await showConfirmMessageModal(
      `Delete ${entries.length} file(s) on the REMOTE? This cannot be undone.`,
      'Delete'
    );
    if (!confirmed) {
      return;
    }

    await runCompareGroup(entries, ctx => removeRemote(ctx));
  },
});

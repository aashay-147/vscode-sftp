import { COMMAND_COMPARE_GROUP_DOWNLOAD } from '../constants';
import { downloadFile } from '../fileHandlers';
import { CompareStatus } from '../fileHandlers/compare';
import { showConfirmMessageModal } from '../host';
import { checkCommand } from './abstract/createCommand';
import { compareGroupEntries, runCompareGroup } from './shared';

// Download every file in a compare group from the remote. Additive for a
// New-Remote group (the files don't exist locally yet); for a Modified group it
// overwrites the local copies, so that case is gated behind a modal confirm.
export default checkCommand({
  id: COMMAND_COMPARE_GROUP_DOWNLOAD,

  async handleCommand(node) {
    const entries = compareGroupEntries(node);
    if (!entries.length) {
      return;
    }

    if (node.status === CompareStatus.Modified) {
      const confirmed = await showConfirmMessageModal(
        `Overwrite ${entries.length} local file(s) with the remote version? This cannot be undone.`,
        'Overwrite'
      );
      if (!confirmed) {
        return;
      }
    }

    await runCompareGroup(entries, uri => downloadFile(uri, { ignore: null }));
  },
});

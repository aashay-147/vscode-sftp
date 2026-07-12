import { COMMAND_COMPARE_GROUP_UPLOAD } from '../constants';
import { uploadFile } from '../fileHandlers';
import { CompareStatus } from '../fileHandlers/compare';
import { showConfirmMessageModal } from '../host';
import { checkCommand } from './abstract/createCommand';
import { compareGroupEntries, runCompareGroup } from './shared';

// Upload every file in a compare group to the remote. Additive for a New-Local
// group (the files don't exist remotely yet); for a Modified group it overwrites
// the remote copies, so that case is gated behind a modal confirm.
export default checkCommand({
  id: COMMAND_COMPARE_GROUP_UPLOAD,

  async handleCommand(node) {
    const entries = compareGroupEntries(node);
    if (!entries.length) {
      return;
    }

    if (node.status === CompareStatus.Modified) {
      const confirmed = await showConfirmMessageModal(
        `Overwrite ${entries.length} remote file(s) with the local version? This cannot be undone.`,
        'Overwrite'
      );
      if (!confirmed) {
        return;
      }
    }

    // This group action already shows its own batched modal above; suppress the
    // per-file overwrite prompt so a Modified group doesn't fire N more prompts.
    await runCompareGroup(entries, uri =>
      uploadFile(uri, { ignore: null, confirmOverwrite: false })
    );
  },
});

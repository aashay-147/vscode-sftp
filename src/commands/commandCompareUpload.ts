import { COMMAND_COMPARE_UPLOAD, COMMAND_COMPARE_REFRESH } from '../constants';
import { executeCommand } from '../host';
import { uploadFile } from '../fileHandlers';
import { checkCommand } from './abstract/createCommand';
import { ctxFromCompareEntry } from './shared';
import { ensureUploadAllowed } from './uploadGuard';

export default checkCommand({
  id: COMMAND_COMPARE_UPLOAD,

  async handleCommand(node) {
    if (!node || node.kind !== 'entry') {
      return;
    }

    const ctx = ctxFromCompareEntry(node.entry);
    if (!ensureUploadAllowed(ctx)) {
      return;
    }
    // Compare-view upload is an explicit act on a known-differing file; suppress
    // the per-file overwrite prompt so it doesn't double up on the compare flow.
    // skipUnmodified is off too: the entry is known-different, re-checking
    // wastes a round-trip. The context is already an exact pair, so no
    // useLocalDownloadPath flag is needed.
    await uploadFile(ctx, { ignore: null, confirmOverwrite: false, skipUnmodified: false });
    await executeCommand(COMMAND_COMPARE_REFRESH);
  },
});

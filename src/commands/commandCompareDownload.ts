import { COMMAND_COMPARE_DOWNLOAD, COMMAND_COMPARE_REFRESH } from '../constants';
import { executeCommand } from '../host';
import { downloadFile } from '../fileHandlers';
import { checkCommand } from './abstract/createCommand';
import { ctxFromCompareEntry } from './shared';

export default checkCommand({
  id: COMMAND_COMPARE_DOWNLOAD,

  async handleCommand(node) {
    if (!node || node.kind !== 'entry') {
      return;
    }

    // Compare-view download is an explicit act on a known-differing file; suppress
    // the per-file overwrite prompt so it doesn't double up on the compare flow.
    // skipUnmodified is off too: the entry is known-different, re-checking
    // wastes a round-trip. The context is already an exact pair, so no
    // useLocalDownloadPath flag is needed.
    await downloadFile(ctxFromCompareEntry(node.entry), {
      ignore: null,
      confirmOverwrite: false,
      skipUnmodified: false,
    });
    await executeCommand(COMMAND_COMPARE_REFRESH);
  },
});

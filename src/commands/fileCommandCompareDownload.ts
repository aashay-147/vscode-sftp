import { COMMAND_COMPARE_DOWNLOAD, COMMAND_COMPARE_REFRESH } from '../constants';
import { executeCommand } from '../host';
import { downloadFile } from '../fileHandlers';
import { uriFromCompareItem } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_COMPARE_DOWNLOAD,
  getFileTarget: uriFromCompareItem,

  async handleFile(ctx) {
    // Compare-view download is an explicit act on a known-differing file; suppress
    // the per-file overwrite prompt so it doesn't double up on the compare flow.
    // skipUnmodified is off too: the entry is known-different, re-checking
    // wastes a round-trip.
    await downloadFile(ctx, { ignore: null, confirmOverwrite: false, skipUnmodified: false });
    await executeCommand(COMMAND_COMPARE_REFRESH);
  },
});

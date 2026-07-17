import { COMMAND_COMPARE_UPLOAD, COMMAND_COMPARE_REFRESH } from '../constants';
import { executeCommand } from '../host';
import { uploadFile } from '../fileHandlers';
import { uriFromCompareItem } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_COMPARE_UPLOAD,
  getFileTarget: uriFromCompareItem,

  async handleFile(ctx) {
    // Compare-view upload is an explicit act on a known-differing file; suppress
    // the per-file overwrite prompt so it doesn't double up on the compare flow.
    // skipUnmodified is off too: the entry is known-different, re-checking
    // wastes a round-trip.
    await uploadFile(ctx, { ignore: null, confirmOverwrite: false, skipUnmodified: false });
    await executeCommand(COMMAND_COMPARE_REFRESH);
  },
});

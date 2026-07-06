import { COMMAND_COMPARE_STAMP_FROM_LOCAL, COMMAND_COMPARE_REFRESH } from '../constants';
import { executeCommand } from '../host';
import { matchTimestamp } from '../fileHandlers';
import { uriFromCompareItem } from './shared';
import { checkFileCommand } from './abstract/createCommand';

// Set the remote file's mtime to match the local's, without transferring bytes.
export default checkFileCommand({
  id: COMMAND_COMPARE_STAMP_FROM_LOCAL,
  getFileTarget: uriFromCompareItem,

  async handleFile(ctx) {
    await matchTimestamp(ctx, { source: 'local' });
    await executeCommand(COMMAND_COMPARE_REFRESH);
  },
});

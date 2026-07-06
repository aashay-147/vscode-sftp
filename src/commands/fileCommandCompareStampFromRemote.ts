import { COMMAND_COMPARE_STAMP_FROM_REMOTE, COMMAND_COMPARE_REFRESH } from '../constants';
import { executeCommand } from '../host';
import { matchTimestamp } from '../fileHandlers';
import { uriFromCompareItem } from './shared';
import { checkFileCommand } from './abstract/createCommand';

// Set the local file's mtime to match the remote's, without transferring bytes.
export default checkFileCommand({
  id: COMMAND_COMPARE_STAMP_FROM_REMOTE,
  getFileTarget: uriFromCompareItem,

  async handleFile(ctx) {
    await matchTimestamp(ctx, { source: 'remote' });
    await executeCommand(COMMAND_COMPARE_REFRESH);
  },
});

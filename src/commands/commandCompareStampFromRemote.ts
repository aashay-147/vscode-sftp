import { COMMAND_COMPARE_STAMP_FROM_REMOTE, COMMAND_COMPARE_REFRESH } from '../constants';
import { executeCommand } from '../host';
import { matchTimestamp } from '../fileHandlers';
import { checkCommand } from './abstract/createCommand';
import { ctxFromCompareEntry } from './shared';

// Set the local file's mtime to match the remote's, without transferring bytes.
export default checkCommand({
  id: COMMAND_COMPARE_STAMP_FROM_REMOTE,

  async handleCommand(node) {
    if (!node || node.kind !== 'entry') {
      return;
    }

    await matchTimestamp(ctxFromCompareEntry(node.entry), { source: 'remote' });
    await executeCommand(COMMAND_COMPARE_REFRESH);
  },
});

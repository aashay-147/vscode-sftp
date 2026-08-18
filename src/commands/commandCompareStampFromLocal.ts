import { COMMAND_COMPARE_STAMP_FROM_LOCAL, COMMAND_COMPARE_REFRESH } from '../constants';
import { executeCommand } from '../host';
import { matchTimestamp } from '../fileHandlers';
import { checkCommand } from './abstract/createCommand';
import { ctxFromCompareEntry } from './shared';

// Set the remote file's mtime to match the local's, without transferring bytes.
export default checkCommand({
  id: COMMAND_COMPARE_STAMP_FROM_LOCAL,

  async handleCommand(node) {
    if (!node || node.kind !== 'entry') {
      return;
    }

    await matchTimestamp(ctxFromCompareEntry(node.entry), { source: 'local' });
    await executeCommand(COMMAND_COMPARE_REFRESH);
  },
});

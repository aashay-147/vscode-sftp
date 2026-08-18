import { COMMAND_COMPARE_GROUP_STAMP_FROM_REMOTE } from '../constants';
import { matchTimestamp } from '../fileHandlers';
import { checkCommand } from './abstract/createCommand';
import { compareGroupEntries, runCompareGroup } from './shared';

// Stamp every local file in a Timestamp-Only group to match its remote mtime,
// without transferring content - clears the whole group's timestamp drift.
export default checkCommand({
  id: COMMAND_COMPARE_GROUP_STAMP_FROM_REMOTE,

  async handleCommand(node) {
    const entries = compareGroupEntries(node);
    if (!entries.length) {
      return;
    }

    await runCompareGroup(entries, ctx => matchTimestamp(ctx, { source: 'remote' }));
  },
});

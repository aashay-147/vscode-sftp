import { COMMAND_COMPARE_GROUP_STAMP_FROM_LOCAL } from '../constants';
import { matchTimestamp } from '../fileHandlers';
import { checkCommand } from './abstract/createCommand';
import { compareGroupEntries, runCompareGroup } from './shared';

// Stamp every remote file in a Timestamp-Only group to match its local mtime,
// without transferring content - clears the whole group's timestamp drift.
export default checkCommand({
  id: COMMAND_COMPARE_GROUP_STAMP_FROM_LOCAL,

  async handleCommand(node) {
    const entries = compareGroupEntries(node);
    if (!entries.length) {
      return;
    }

    await runCompareGroup(entries, ctx => matchTimestamp(ctx, { source: 'local' }));
  },
});

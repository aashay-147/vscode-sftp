import { COMMAND_COMPARE_DIFF } from '../constants';
import { diff } from '../fileHandlers';
import { checkCommand } from './abstract/createCommand';
import { ctxFromCompareEntry } from './shared';

// checkCommand, not checkFileCommand: the fileCommand* convention rebuilds the
// context from a bare local uri, which loses the exact remote pair the compare
// walk resolved (mirror roots, out-of-workspace bases, profiles).
export default checkCommand({
  id: COMMAND_COMPARE_DIFF,

  async handleCommand(node) {
    if (!node || node.kind !== 'entry') {
      return;
    }

    await diff(ctxFromCompareEntry(node.entry));
  },
});

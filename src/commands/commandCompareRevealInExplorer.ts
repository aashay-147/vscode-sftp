import { Uri } from 'vscode';
import { COMMAND_COMPARE_REVEAL_IN_EXPLORER } from '../constants';
import { executeCommand } from '../host';
import { checkCommand } from './abstract/createCommand';
import { canRevealCompareLocal, compareNodeTarget } from './compareNode';

export default checkCommand({
  id: COMMAND_COMPARE_REVEAL_IN_EXPLORER,

  async handleCommand(node) {
    const target = compareNodeTarget(node);
    if (!target || !canRevealCompareLocal(target.status)) {
      return;
    }

    await executeCommand('revealInExplorer', Uri.file(target.localFsPath));
  },
});

import app from '../app';
import { COMMAND_COMPARE_REVEAL_IN_REMOTE_EXPLORER } from '../constants';
import { UResource } from '../core';
import { checkCommand } from './abstract/createCommand';
import { canRevealCompareRemote, compareNodeTarget } from './compareNode';
import { ctxFromCompareEntry } from './shared';

export default checkCommand({
  id: COMMAND_COMPARE_REVEAL_IN_REMOTE_EXPLORER,

  async handleCommand(node) {
    const target = compareNodeTarget(node);
    if (!target || !canRevealCompareRemote(target.status)) {
      return;
    }

    const ctx = ctxFromCompareEntry(target);
    await app.remoteExplorer.reveal({
      resource: UResource.makeResource(ctx.target.remoteUri),
      isDirectory: target.isDirectory,
    });
  },
});

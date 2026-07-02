import { COMMAND_COMPARE_DIFF } from '../constants';
import { diff } from '../fileHandlers';
import { uriFromCompareItem } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_COMPARE_DIFF,
  getFileTarget: uriFromCompareItem,

  async handleFile(ctx) {
    await diff(ctx);
  },
});

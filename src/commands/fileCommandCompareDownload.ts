import { COMMAND_COMPARE_DOWNLOAD, COMMAND_COMPARE_REFRESH } from '../constants';
import { executeCommand } from '../host';
import { downloadFile } from '../fileHandlers';
import { uriFromCompareItem } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_COMPARE_DOWNLOAD,
  getFileTarget: uriFromCompareItem,

  async handleFile(ctx) {
    await downloadFile(ctx, { ignore: null });
    await executeCommand(COMMAND_COMPARE_REFRESH);
  },
});

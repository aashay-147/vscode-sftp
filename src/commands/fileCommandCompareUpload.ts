import { COMMAND_COMPARE_UPLOAD, COMMAND_COMPARE_REFRESH } from '../constants';
import { executeCommand } from '../host';
import { uploadFile } from '../fileHandlers';
import { uriFromCompareItem } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_COMPARE_UPLOAD,
  getFileTarget: uriFromCompareItem,

  async handleFile(ctx) {
    await uploadFile(ctx, { ignore: null });
    await executeCommand(COMMAND_COMPARE_REFRESH);
  },
});

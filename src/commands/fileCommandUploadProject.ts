import { COMMAND_UPLOAD_PROJECT } from '../constants';
import { uploadFolder } from '../fileHandlers';
import { selectContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_UPLOAD_PROJECT,
  getFileTarget: selectContext,

  async handleFile(ctx) {
    // Explicit command: tell the user when the target matches ignore instead
    // of silently doing nothing.
    await uploadFolder(ctx, { notifyIgnored: true });
  },
});

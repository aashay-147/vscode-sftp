import { COMMAND_DOWNLOAD_PROJECT } from '../constants';
import { downloadFolder } from '../fileHandlers';
import { selectContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_DOWNLOAD_PROJECT,
  getFileTarget: selectContext,

  async handleFile(ctx) {
    // Explicit command: tell the user when the target matches ignore instead
    // of silently doing nothing.
    await downloadFolder(ctx, { notifyIgnored: true });
  },
});

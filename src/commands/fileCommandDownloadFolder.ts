import { COMMAND_DOWNLOAD_FOLDER } from '../constants';
import { downloadFolder } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_DOWNLOAD_FOLDER,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    // Explicit command: tell the user when the target matches ignore instead
    // of silently doing nothing.
    await downloadFolder(ctx, { notifyIgnored: true });
  },
});

import { COMMAND_UPLOAD_FOLDER } from '../constants';
import { uploadFolder } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import { ensureUploadAllowed } from './uploadGuard';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_UPLOAD_FOLDER,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    if (!ensureUploadAllowed(ctx)) {
      return;
    }
    // Explicit command: tell the user when the target matches ignore instead
    // of silently doing nothing.
    await uploadFolder(ctx, { notifyIgnored: true, useLocalDownloadPath: true });
  },
});

import { COMMAND_UPLOAD_ACTIVEFOLDER_TO_ALL_PROFILES } from '../constants';
import { uploadFolder } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import fileCommandUploadActiveFolder from './fileCommandUploadActiveFolder';
import { ensureUploadAllowed } from './uploadGuard';

export default checkFileCommand({
  ...fileCommandUploadActiveFolder,
  id: COMMAND_UPLOAD_ACTIVEFOLDER_TO_ALL_PROFILES,

  async handleFile(ctx) {
    if (!ensureUploadAllowed(ctx)) {
      return;
    }
    // Multi-profile flow: the staged modal offers Skip This Profile / Cancel
    // remaining instead of Review (compare-view actions bind to the active
    // profile only).
    await uploadFolder(ctx, {
      notifyIgnored: true,
      _multiProfileFlow: true,
      useLocalDownloadPath: true,
    });
  },
});

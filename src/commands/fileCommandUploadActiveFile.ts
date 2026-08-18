import { COMMAND_UPLOAD_ACTIVEFILE } from '../constants';
import { uploadFile } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import { ensureUploadAllowed } from './uploadGuard';
import { getActiveDocumentUri } from './shared';

export default checkFileCommand({
  id: COMMAND_UPLOAD_ACTIVEFILE,
  getFileTarget: getActiveDocumentUri,

  async handleFile(ctx) {
    if (!ensureUploadAllowed(ctx)) {
      return;
    }
    await uploadFile(ctx, { ignore: null, useLocalDownloadPath: true });
  },
});

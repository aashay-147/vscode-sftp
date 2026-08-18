import { COMMAND_UPLOAD_TO_ALL_PROFILES } from '../constants';
import { upload } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import fileCommandUpload from './fileCommandUpload';

export default checkFileCommand({
  ...fileCommandUpload,
  id: COMMAND_UPLOAD_TO_ALL_PROFILES,

  async handleFile(ctx) {
    // Multi-profile flow: when the target is a folder, the staged modal offers
    // Skip This Profile / Cancel remaining instead of Review (compare-view
    // actions bind to the active profile only).
    await upload(ctx, { ignore: null, _multiProfileFlow: true, useLocalDownloadPath: true });
  },
});

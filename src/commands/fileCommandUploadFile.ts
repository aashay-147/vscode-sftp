import { COMMAND_UPLOAD_FILE } from '../constants';
import { TransferDirection } from '../core';
import { uploadFile, transferSelectedFiles } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_UPLOAD_FILE,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await uploadFile(ctx, { ignore: null, useLocalDownloadPath: true });
  },

  // Multi-select: aggregate the whole selection into one staged counts modal
  // per service (folders in the selection each run their own staged flow).
  async handleMulti(uris) {
    await transferSelectedFiles(uris, TransferDirection.LOCAL_TO_REMOTE, {
      ignore: null,
      useLocalDownloadPath: true,
    });
  },
});

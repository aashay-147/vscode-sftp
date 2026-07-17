import { COMMAND_DOWNLOAD_FILE } from '../constants';
import { TransferDirection } from '../core';
import { downloadFile, transferSelectedFiles } from '../fileHandlers';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_DOWNLOAD_FILE,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await downloadFile(ctx, { ignore: null });
  },

  // Multi-select: aggregate the whole selection into one staged counts modal
  // per service (folders in the selection each run their own staged flow).
  async handleMulti(uris) {
    await transferSelectedFiles(uris, TransferDirection.REMOTE_TO_LOCAL, { ignore: null });
  },
});

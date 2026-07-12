import { COMMAND_FORCE_UPLOAD } from '../constants';
import { upload } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_FORCE_UPLOAD,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    // Force upload never prompts, even with confirmOverwrite on. createFileHandler
    // applies call-site options after transformOption, so this overrides the
    // config value and preserves "force = no prompt".
    await upload(ctx, { ignore: null, confirmOverwrite: false });
  },
});

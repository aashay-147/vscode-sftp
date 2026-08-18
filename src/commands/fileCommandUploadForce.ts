import { COMMAND_FORCE_UPLOAD } from '../constants';
import { upload } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_FORCE_UPLOAD,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    // Force upload never prompts, never stages, never skips — even with
    // confirmOverwrite/skipUnmodified on. createFileHandler applies call-site
    // options after transformOption, so this overrides the config values and
    // preserves "force = transfer exactly this, no questions".
    await upload(ctx, {
      ignore: null,
      confirmOverwrite: false,
      skipUnmodified: false,
      useLocalDownloadPath: true,
    });
  },
});

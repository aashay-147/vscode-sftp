import { COMMAND_FORCE_DOWNLOAD } from '../constants';
import { download } from '../fileHandlers';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_FORCE_DOWNLOAD,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    // Force download never prompts, never stages, never skips (see the
    // force-upload command for why the call-site override wins).
    await download(ctx, {
      ignore: null,
      confirmOverwrite: false,
      skipUnmodified: false,
      useLocalDownloadPath: true,
    });
  },
});

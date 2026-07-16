import { COMMAND_REMOTEEXPLORER_EDITINLOCAL } from '../constants';
import { downloadFile } from '../fileHandlers';
import { showTextDocument } from '../host';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_REMOTEEXPLORER_EDITINLOCAL,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    // Edit-in-Local intentionally replaces the local copy; prompting to
    // overwrite it would defeat the command.
    await downloadFile(ctx, { ignore: null, confirmOverwrite: false });
    await showTextDocument(ctx.target.localUri, { preview: true });
  },
});

import { window, Uri } from 'vscode';
import app from '../app';
import { COMMAND_COMPARE_FILE } from '../constants';
import { executeCommand } from '../host';
import { compareFiles } from '../fileHandlers';
import { checkCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

// Compare one or more explicitly selected files (Explorer, editor, or Remote
// Explorer) and load just those into the sftpCompare view. This is a
// createCommand, NOT a createFileCommand: the latter fans a Uri[] out into one
// handleFile per uri, and each per-file setResult would clobber the previous
// one, leaving only the last file in the view. We aggregate all uris into a
// single compareFiles() call instead.
export default checkCommand({
  id: COMMAND_COMPARE_FILE,

  async handleCommand(item, items) {
    const target = uriFromExplorerContextOrEditorContext(item, items);
    if (!target) {
      return;
    }

    const uris: Uri[] = Array.isArray(target) ? target : [target];
    await compareFiles(uris);

    try {
      await executeCommand('sftpCompare.focus');
    } catch (error) {
      // the view may not be visible yet; the result is stored regardless
    }

    const result = app.compareExplorer && app.compareExplorer.lastResult;
    if (result && result.entries.length === 0) {
      window.showInformationMessage('SFTP: No differences found between local and remote.');
    }
  },
});

import { window } from 'vscode';
import app from '../app';
import { COMMAND_COMPARE_FOLDER } from '../constants';
import { executeCommand } from '../host';
import { compareFolders } from '../fileHandlers';
import { selectFolderFallbackToConfigContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_COMPARE_FOLDER,
  getFileTarget: selectFolderFallbackToConfigContext,

  async handleFile(ctx) {
    await compareFolders(ctx);

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

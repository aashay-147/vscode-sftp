import { COMMAND_DIFF_WITH_LOCAL } from '../constants';
import { diff } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

// "Diff with Local" — the remote-explorer counterpart of `sftp.diff`. The diff
// handler is symmetric (it always fetches the remote to a tmp file and diffs it
// against the local copy), so this reuses it verbatim; only the command title
// differs, framing the action from the remote file's vantage point.
export default checkFileCommand({
  id: COMMAND_DIFF_WITH_LOCAL,
  getFileTarget: uriFromExplorerContextOrEditorContext,
  handleFile: diff,
});

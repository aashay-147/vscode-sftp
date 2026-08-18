import { COMMAND_SYNC_LOCAL_TO_REMOTE } from '../constants';
import { sync2Remote } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import { ensureUploadAllowed } from './uploadGuard';
import { selectFolderFallbackToConfigContext, uriFromfspath, applySelector } from './shared';

export default checkFileCommand({
  id: COMMAND_SYNC_LOCAL_TO_REMOTE,
  getFileTarget: applySelector(uriFromfspath, selectFolderFallbackToConfigContext),

  handleFile(ctx) {
    if (!ensureUploadAllowed(ctx)) {
      return Promise.resolve();
    }
    return sync2Remote(ctx);
  },
});

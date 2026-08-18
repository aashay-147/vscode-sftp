import { COMMAND_SYNC_BOTH_DIRECTIONS } from '../constants';
import { sync2Remote } from '../fileHandlers';
import { checkFileCommand } from './abstract/createCommand';
import { ensureUploadAllowed } from './uploadGuard';
import { selectFolderFallbackToConfigContext, uriFromfspath, applySelector } from './shared';

export default checkFileCommand({
  id: COMMAND_SYNC_BOTH_DIRECTIONS,
  getFileTarget: applySelector(uriFromfspath, selectFolderFallbackToConfigContext),

  handleFile(ctx) {
    if (!ensureUploadAllowed(ctx)) {
      return Promise.resolve();
    }
    return sync2Remote(ctx, { bothDiretions: true });
  },
});

// Global pause (Feature 5): every running transfer scheduler stops starting
// new tasks; in-flight files finish, queues are kept for Resume. The global
// stop that actually drops the queues stays `sftp.cancelAllTransfer`.
import { COMMAND_TRANSFER_PAUSE } from '../constants';
import { setPaused } from '../ui/transferControls';
import { checkCommand } from './abstract/createCommand';
import { findAllFileService } from '../modules/serviceManager';

export default checkCommand({
  id: COMMAND_TRANSFER_PAUSE,

  async handleCommand() {
    findAllFileService(f => f.isTransferring()).forEach(f => f.pauseTransferTasks());
    setPaused(true);
  },
});

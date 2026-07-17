// Global resume (Feature 5): drains the queues kept by `sftp.transfer.pause`.
import { COMMAND_TRANSFER_RESUME } from '../constants';
import { setPaused } from '../ui/transferControls';
import { checkCommand } from './abstract/createCommand';
import { findAllFileService } from '../modules/serviceManager';

export default checkCommand({
  id: COMMAND_TRANSFER_RESUME,

  async handleCommand() {
    setPaused(false);
    findAllFileService(f => f.isTransferring()).forEach(f => f.resumeTransferTasks());
  },
});

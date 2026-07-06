import { COMMAND_COMPARE_ACTIVEFOLDER } from '../constants';
import { checkFileCommand } from './abstract/createCommand';
import { getActiveFolder } from './shared';
import fileCommandCompareFolder from './fileCommandCompareFolder';

export default checkFileCommand({
  ...fileCommandCompareFolder,
  id: COMMAND_COMPARE_ACTIVEFOLDER,
  getFileTarget: getActiveFolder,
});

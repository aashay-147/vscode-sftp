import { Uri, window } from 'vscode';
import logger from '../../logger';
import {
  COMMAND_UPLOAD_FILE_TO_ALL_PROFILES,
  COMMAND_UPLOAD_FOLDER_TO_ALL_PROFILES,
} from '../../constants';
import { reportError } from '../../helper';
import { handleCtxFromUri, allHandleCtxFromUri, FileHandlerContext } from '../../fileHandlers';
import { StagedTransferCancelledError } from '../../fileHandlers/transfer/stagedTransfer';
import { getFileService } from '../../modules/serviceManager';
import Command from './command';

// With confirmOverwrite on, a concurrent fan-out would stack several modals at
// once (multi-select, all-profiles). Run those targets sequentially instead so
// prompts appear one at a time; flag-off keeps the concurrent fan-out.
function hasConfirmOverwrite(uri: Uri): boolean {
  const fileService = getFileService(uri);
  return fileService ? Boolean(fileService.getConfig().confirmOverwrite) : false;
}

interface BaseCommandOption {
  id: string;
  name?: string;
}

interface CommandOption extends BaseCommandOption {
  handleCommand: (this: Command, ...args: any[]) => unknown | Promise<unknown>;
}

interface FileCommandOption extends BaseCommandOption {
  handleFile: (ctx: FileHandlerContext) => Promise<unknown>;
  getFileTarget: (...args: any[]) => undefined | Uri | Uri[] | Promise<undefined | Uri | Uri[]>;
  // Optional multi-select hook: when the command receives more than one target
  // it takes over the whole selection (aggregated staging — one counts modal
  // per service instead of a per-uri fan-out). Commands without it keep the
  // per-uri fan-out below.
  handleMulti?: (uris: Uri[]) => Promise<unknown>;
}

function checkType<T>() {
  return (a: T) => a;
}

export const checkCommand = checkType<CommandOption>();
export const checkFileCommand = checkType<FileCommandOption>();

export function createCommand(commandOption: CommandOption & { name: string }) {
  return class NormalCommand extends Command {
    constructor() {
      super();
      this.id = commandOption.id;
      this.name = commandOption.name;
    }

    doCommandRun(...args) {
      commandOption.handleCommand.apply(this, args);
    }
  };
}

export function createFileCommand(commandOption: FileCommandOption & { name: string }) {
  return class FileCommand extends Command {
    constructor() {
      super();
      this.id = commandOption.id;
      this.name = commandOption.name;
    }

    protected async doCommandRun(...args) {
      if ((this.id === COMMAND_UPLOAD_FILE_TO_ALL_PROFILES || this.id === COMMAND_UPLOAD_FOLDER_TO_ALL_PROFILES) 
        && await window.showInformationMessage('Are you sure you want to upload to all profiles?', 'Yes', 'No').then(answer => answer !== 'Yes')) {
        return;
      }
      
      const target = await commandOption.getFileTarget(...args);
      if (!target) {
        logger.warn(`The "${this.name}" command get canceled because of missing targets.`);
        return;
      }

      const targetList: Uri[] = Array.isArray(target) ? target : [target];

      if (targetList.length > 1 && commandOption.handleMulti) {
        try {
          await commandOption.handleMulti(targetList);
        } catch (error) {
          if (!(error instanceof StagedTransferCancelledError)) {
            reportError(error);
          }
        }
        return;
      }

      const run = async (uri: Uri) => {
        try {
          await commandOption.handleFile(handleCtxFromUri(uri));
        } catch (error) {
          reportError(error);
        }
      };

      if (targetList.length > 1 && targetList.some(hasConfirmOverwrite)) {
        for (const uri of targetList) {
          await run(uri);
        }
      } else {
        await Promise.all(targetList.map(run));
      }
    }
  };
}

export function createFileMultiCommand(commandOption: FileCommandOption & { name: string }) {
  return class FileCommand extends Command {
    constructor() {
      super();
      this.id = commandOption.id;
      this.name = commandOption.name;
    }

    protected async doCommandRun(...args) {
      if ((this.id === COMMAND_UPLOAD_FILE_TO_ALL_PROFILES || this.id === COMMAND_UPLOAD_FOLDER_TO_ALL_PROFILES) 
        && await window.showInformationMessage('Are you sure you want to upload to all profiles?', 'Yes', 'No').then(answer => answer !== 'Yes')) {
        return;
      }
      
      const target = await commandOption.getFileTarget(...args);
      if (!target) {
        logger.warn(`The "${this.name}" command get canceled because of missing targets.`);
        return;
      }

      const targetList: Uri[] = Array.isArray(target) ? target : [target];
      const run = async (uri: Uri) => {
        try {
          const ctxs = allHandleCtxFromUri(uri);
          // One profile at a time when any profile could prompt — a concurrent
          // fan-out races several modals for different destinations.
          if (ctxs.some(ctx => Boolean(ctx.config.confirmOverwrite))) {
            for (const ctx of ctxs) {
              await commandOption.handleFile(ctx);
            }
          } else {
            await Promise.all(ctxs.map(commandOption.handleFile));
          }
        } catch (error) {
          if (error instanceof StagedTransferCancelledError) {
            // user chose Cancel in a staged multi-profile modal — stop the
            // remaining profiles for this target quietly
            return;
          }
          reportError(error);
        }
      };

      if (targetList.length > 1 && targetList.some(hasConfirmOverwrite)) {
        for (const uri of targetList) {
          await run(uri);
        }
      } else {
        await Promise.all(targetList.map(run));
      }
    }
  };
}

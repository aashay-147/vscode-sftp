import { Uri } from 'vscode';
import * as path from 'path';
import app from '../app';
import { UResource, FileService, ServiceConfig } from '../core';
import { isPathUnder, resolveLocalDownloadPathBase } from '../helper';
import { showInformationMessage } from '../host';
import logger from '../logger';
import { getFileService } from '../modules/serviceManager';

interface FileHandlerConfig {
  _?: boolean;
}

export interface FileHandlerContext {
  target: UResource;
  fileService: FileService;
  config: ServiceConfig;
  // the uri the command was invoked with (the side the user clicked), when
  // the context was built from one — compare uses it to tell a remote-origin
  // walk from a local-origin one (Feature 9 root derivation)
  originUri?: Uri;
}

type FileHandlerContextMethod<R = void> = (this: FileHandlerContext) => R;
type FileHandlerContextMethodArg1<A, R = void> = (this: FileHandlerContext, a: A) => R;

interface FileHandlerOption<T> {
  name: string;
  handle: FileHandlerContextMethodArg1<T, Promise<any>>;
  afterHandle?: FileHandlerContextMethod;
  config?: FileHandlerConfig;
  transformOption?: FileHandlerContextMethod<T>;
}

// Which local base a local uri maps against. Uris under the service's baseDir
// keep the workspace mapping (so uploadOnSave/watcher behavior never changes);
// a uri outside it can only have resolved here via a mirror-base trie alias
// (Feature 9), so it maps as an exact pair against the ACTIVE profile's
// resolved base. A uri covered only by a non-active profile's mirror gets a
// clear error naming that profile.
function resolveLocalBasePath(
  fileService: FileService,
  config: ServiceConfig,
  uri: Uri
): string {
  if (UResource.isRemote(uri) || isPathUnder(fileService.baseDir, uri.fsPath)) {
    return fileService.baseDir;
  }

  const base = resolveLocalDownloadPathBase(config.localDownloadPath, fileService.baseDir);
  if (base && isPathUnder(base, uri.fsPath)) {
    return base;
  }

  const profile = findProfileWithBaseCovering(fileService, uri.fsPath);
  if (profile) {
    throw new Error(
      `'${uri.fsPath}' is under the localDownloadPath of profile '${profile}', which is not active.` +
        ' Run "SFTP: Set Profile" to switch to it first.'
    );
  }
  return fileService.baseDir;
}

function findProfileWithBaseCovering(
  fileService: FileService,
  fsPath: string
): string | undefined {
  for (const name of fileService.getAvailableProfiles()) {
    try {
      const config = fileService.getConfig(name);
      const base = resolveLocalDownloadPathBase(config.localDownloadPath, fileService.baseDir);
      if (base && isPathUnder(base, fsPath)) {
        return name;
      }
    } catch (error) {
      // invalid profile config — not a candidate
    }
  }
  return undefined;
}

export function handleCtxFromUri(uri: Uri): FileHandlerContext {
  const fileService = getFileService(uri);
  if (!fileService) {
    if (uri.toString(true) == "file:///${command:sftp.sync.remoteToLocal}") {
      throw '';
    } else {
      throw new Error(`Config Not Found. (${uri.toString(true)})`);
    }
  }
  const config = fileService.getConfig();
  const target = UResource.from(uri, {
    localBasePath: resolveLocalBasePath(fileService, config, uri),
    remoteBasePath: config.remotePath,
    remoteId: fileService.id,
    remote: {
      host: config.host,
      port: config.port,
    },
  });

  return {
    fileService,
    config,
    target,
    originUri: uri,
  };
}

export function allHandleCtxFromUri(uri: Uri): Array<FileHandlerContext> {
  const fileService = getFileService(uri);
  if (!fileService) {
    if (uri.toString(true) == "file:///${command:sftp.sync.remoteToLocal}") {
      throw '';
    } else {
      throw new Error(`Config Not Found. (${uri.toString(true)})`);
    }
  }

  const configArr = fileService.getAllConfig();

  // Feature 9: a local uri outside baseDir can only be a mirror file. Each
  // profile maps it against its OWN resolved base; profiles whose mirror does
  // not cover the uri are skipped (a to-all-profiles action cannot invent a
  // sensible workspace mapping for a path outside the workspace).
  const outsideBaseDir =
    !UResource.isRemote(uri) && !isPathUnder(fileService.baseDir, uri.fsPath);
  let candidates = configArr;
  if (outsideBaseDir) {
    candidates = configArr.filter(config => {
      const base = resolveLocalDownloadPathBase(config.localDownloadPath, fileService.baseDir);
      return Boolean(base && isPathUnder(base, uri.fsPath));
    });
    if (candidates.length === 0) {
      throw new Error(`Config Not Found. (${uri.toString(true)})`);
    }
  }

  return candidates.map(config => {
    const localBasePath = outsideBaseDir
      ? resolveLocalDownloadPathBase(config.localDownloadPath, fileService.baseDir)!
      : fileService.baseDir;
    const target = UResource.from(uri, {
      localBasePath,
      remoteBasePath: config.remotePath,
      remoteId: fileService.id,
      remote: {
        host: config.host,
        port: config.port,
      },
    });

    return {
      fileService,
      config,
      target,
      originUri: uri,
    };
  })
}

export default function createFileHandler<T>(
  handlerOption: FileHandlerOption<T>
): (ctx: FileHandlerContext | Uri, option?: Partial<T>) => Promise<void> {
  async function fileHandle(ctx: Uri | FileHandlerContext, option?: T) {
    const handleCtx = ctx instanceof Uri ? handleCtxFromUri(ctx) : ctx;
    const { target } = handleCtx;

    const invokeOption = handlerOption.transformOption
      ? handlerOption.transformOption.call(handleCtx)
      : {};
    if (option) {
      Object.assign(invokeOption, option);
    }

    if (invokeOption.ignore && invokeOption.ignore(target.localFsPath)) {
      if (invokeOption.notifyIgnored) {
        showInformationMessage(
          `'${path.basename(target.localFsPath)}' matches ignore — nothing transferred`
        );
      }
      return;
    }

    logger.trace(`handle ${handlerOption.name} for`, target.localFsPath);

    app.sftpBarItem.startSpinner();
    try {
      await handlerOption.handle.call(handleCtx, invokeOption);
    // } catch (error) {
    //   reportError(error, `when ${handlerOption.name} ${target.localFsPath}`);
    //   Object.defineProperty(error, 'reported', {
    //     configurable: false,
    //     enumerable: false,
    //     value: true,
    //   });
    //   throw error;
    } finally {
      app.sftpBarItem.stopSpinner();
    }
    if (handlerOption.afterHandle) {
      handlerOption.afterHandle.call(handleCtx);
    }
  }

  return fileHandle;
}

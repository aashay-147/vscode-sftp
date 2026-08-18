import * as path from 'path';
import { Uri, window } from 'vscode';
import { FileType, UResource } from '../core';
import app from '../app';
import { COMMAND_COMPARE_REFRESH } from '../constants';
import { getAllFileService, getFileService } from '../modules/serviceManager';
import { ExplorerItem } from '../modules/remoteExplorer';
import { CompareNode } from '../modules/compareExplorer';
import { CompareEntry } from '../fileHandlers/compare';
import { FileHandlerContext } from '../fileHandlers';
import { executeCommand, getActiveTextEditor } from '../host';
import { listFiles, toLocalPath, simplifyPath, reportError } from '../helper';

function configIngoreFilterCreator(config) {
  if (!config || !config.ignore) {
    return;
  }

  return file => !config.ignore(file.fsPath);
}

function createFileSelector(filterCreator?) {
  return async (): Promise<Uri | undefined> => {
    const remoteItems = getAllFileService().map((fileService, index) => {
      const config = fileService.getConfig();
      return {
        name: config.name || config.remotePath,
        description: config.host,
        fsPath: config.remotePath,
        type: FileType.Directory,
        filter: filterCreator ? filterCreator(config) : undefined,
        getFs: () => fileService.getRemoteFileSystem(config),
        index,
        remoteBaseDir: config.remotePath,
        baseDir: fileService.baseDir,
      };
    });

    const selected = await listFiles(remoteItems);

    if (!selected) {
      return;
    }

    const rootItem = remoteItems[selected.index];
    const localTarget = toLocalPath(selected.fsPath, rootItem.remoteBaseDir, rootItem.baseDir);

    return Uri.file(localTarget);
  };
}

export function selectContext(): Promise<Uri | undefined> {
  return new Promise((resolve, reject) => {
    const sercives = getAllFileService();
    const projectsList = sercives
      .map(service => ({
        value: service.baseDir,
        label: service.name || simplifyPath(service.baseDir),
        description: '',
        detail: service.baseDir,
      }))
      .sort((l, r) => l.label.localeCompare(r.label));

    // if (projectsList.length === 1) {
    // return resolve(projectsList[0].value);
    // }

    window
      .showQuickPick(projectsList, {
        placeHolder: 'Select a folder...',
      })
      .then(selection => {
        if (selection) {
          return resolve(Uri.file(selection.value));
        }

        // cancel selection
        resolve();
      }, reject);
  });
}

export function applySelector<T>(...selectors: ((...args: any[]) => T | Promise<T>)[]) {
  return function combinedSelector(...args: any[]): T | Promise<T> {
    let result;
    for (const selector of selectors) {
      result = selector.apply(this, args);
      if (result) {
        break;
      }
    }

    return result;
  };
}

export function uriFromfspath(fileList: string[]): Uri[] | undefined {
  if (!Array.isArray(fileList) || typeof fileList[0] !== 'string') {
    return;
  }

  return fileList.map(file => Uri.file(file));
}

export function getActiveDocumentUri() {
  const active = getActiveTextEditor();
  if (!active || !active.document) {
    return;
  }

  return active.document.uri;
}

export function getActiveFolder() {
  const uri = getActiveDocumentUri();
  if (!uri) {
    return;
  }

  return Uri.file(path.dirname(uri.fsPath));
}

// selected file or activeTarget or configContext
export function uriFromExplorerContextOrEditorContext(item, items): undefined | Uri | Uri[] {
  // from explorer or editor context
  if (item instanceof Uri) {
    if (Array.isArray(items) && items[0] instanceof Uri) {
      // multi-select in explorer
      return items;
    } else {
      return item;
    }
  } else if ((item as ExplorerItem).resource) {
    // from remote explorer
    if (Array.isArray(items) && (items[0] as ExplorerItem).resource) {
      // multi-select in remote explorer
      return items.map(_ => _.resource.uri);
    } else {
      return item.resource.uri;
    }
  }

  return;
}

// selected folder or configContext
export function selectFolderFallbackToConfigContext(item, items): Promise<undefined | Uri | Uri[]> {
  // from explorer or editor context
  if (item) {
    if (item instanceof Uri) {
      if (Array.isArray(items) && items[0] instanceof Uri) {
        // multi-select in explorer
        return Promise.resolve(items);
      } else {
        return Promise.resolve(item);
      }
    } else if ((item as ExplorerItem).resource) {
      // from remote explorer
      return Promise.resolve(item.resource.uri);
    }
  }

  return selectContext();
}

// Exact context for a compare row: the service is resolved by the id stamped
// on the entry (fallback: the config trie), and the target is built as an
// exact local/remote pair (rel '' against both bases), so mirror rows and
// out-of-workspace roots act on precisely the pair the compare walk resolved -
// no round-trip through Uri.file(localFsPath).
export function ctxFromCompareEntry(entry: {
  localFsPath: string;
  remoteFsPath: string;
  serviceId?: number;
}): FileHandlerContext {
  let fileService =
    entry.serviceId != null
      ? getAllFileService().find(service => service.id === entry.serviceId)
      : undefined;
  if (!fileService) {
    fileService = getFileService(Uri.file(entry.localFsPath));
  }
  if (!fileService) {
    throw new Error(`Config Not Found. (${entry.localFsPath})`);
  }

  const config = fileService.getConfig();
  const target = UResource.from(Uri.file(entry.localFsPath), {
    localBasePath: entry.localFsPath,
    remoteBasePath: entry.remoteFsPath,
    remoteId: fileService.id,
    remote: {
      host: config.host,
      port: config.port,
    },
  });

  return { fileService, config, target, originUri: Uri.file(entry.localFsPath) };
}

// All entries belonging to a folder-compare group header, pulled from the live
// compare result. Group nodes only carry their status, so the entries are
// resolved from the tree's last result rather than the node itself.
export function compareGroupEntries(node: CompareNode): CompareEntry[] {
  if (!node || node.kind !== 'group') {
    return [];
  }

  const result = app.compareExplorer && app.compareExplorer.lastResult;
  if (!result) {
    return [];
  }

  return result.entries.filter(entry => entry.status === node.status);
}

// Run a per-file handler across every entry of a compare group, then refresh
// once. Sequential on purpose: FTP serializes on a single control connection
// (PQueue concurrency 1), so parallelism buys nothing and N parallel refreshes
// would each re-walk both trees. Per-file errors are reported but don't abort
// the rest of the batch.
export async function runCompareGroup(
  entries: CompareEntry[],
  run: (ctx: FileHandlerContext) => Promise<unknown>
): Promise<void> {
  for (const entry of entries) {
    try {
      await run(ctxFromCompareEntry(entry));
    } catch (error) {
      reportError(error);
    }
  }

  await executeCommand(COMMAND_COMPARE_REFRESH);
}

// selected file from all remote files
export const selectFileFromAll = createFileSelector();

// selected file from remote files expect ignored
export const selectFile = createFileSelector(configIngoreFilterCreator);

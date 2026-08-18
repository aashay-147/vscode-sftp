import * as path from 'path';
import * as upath from 'upath';
import * as vscode from 'vscode';
import { COMMAND_COMPARE_DIFF } from '../../constants';
import { CompareEntry, CompareResult, CompareStatus } from '../../fileHandlers/compare';

export interface CompareGroup {
  kind: 'group';
  status: CompareStatus;
  label: string;
}

export interface CompareItem {
  kind: 'entry';
  entry: CompareEntry;
}

export interface CompareFolder {
  kind: 'folder';
  status: CompareStatus;
  relDir: string;
  localFsPath: string;
  remoteFsPath: string;
  entries: CompareEntry[];
}

export type CompareNode = CompareGroup | CompareFolder | CompareItem;
export type CompareGrouping = 'flat' | 'path';

const GROUPS: CompareGroup[] = [
  { kind: 'group', status: CompareStatus.Modified, label: 'Modified' },
  { kind: 'group', status: CompareStatus.TimeDiff, label: 'Timestamp Only' },
  { kind: 'group', status: CompareStatus.NewRemote, label: 'New Remote' },
  { kind: 'group', status: CompareStatus.NewLocal, label: 'New Local' },
];

const GROUP_ICONS = {
  [CompareStatus.Modified]: 'diff-modified',
  [CompareStatus.TimeDiff]: 'history',
  [CompareStatus.NewRemote]: 'cloud-download',
  [CompareStatus.NewLocal]: 'cloud-upload',
};

const STATUS_LABELS = {
  [CompareStatus.Modified]: 'Modified',
  [CompareStatus.TimeDiff]: 'Timestamp Only',
  [CompareStatus.NewRemote]: 'New Remote',
  [CompareStatus.NewLocal]: 'New Local',
};

function pathSegments(relPath: string): string[] {
  return relPath.split('/').filter(Boolean);
}

function folderPaths(entry: CompareEntry, relDir: string) {
  const entryDirectoryDepth = Math.max(0, pathSegments(entry.relPath).length - 1);
  const folderDepth = pathSegments(relDir).length;
  const levelsToAscend = Math.max(0, entryDirectoryDepth - folderDepth);

  let localFsPath = path.dirname(entry.localFsPath);
  let remoteFsPath = upath.dirname(entry.remoteFsPath);
  for (let index = 0; index < levelsToAscend; index++) {
    localFsPath = path.dirname(localFsPath);
    remoteFsPath = upath.dirname(remoteFsPath);
  }

  return { localFsPath, remoteFsPath };
}

// Build only one tree level at a time from the flat CompareEntry list. Absolute
// directory paths participate in folder identity so selected-file comparisons
// spanning services cannot merge equal relative paths from different roots.
export function comparePathChildren(
  entries: CompareEntry[],
  status: CompareStatus,
  relDir: string = ''
): Array<CompareFolder | CompareItem> {
  const parentDepth = pathSegments(relDir).length;
  const folders = new Map<string, CompareFolder>();
  const files: CompareItem[] = [];

  entries.forEach(entry => {
    const segments = pathSegments(entry.relPath);
    if (segments.length <= parentDepth + 1) {
      files.push({ kind: 'entry', entry });
      return;
    }

    const childRelDir = segments.slice(0, parentDepth + 1).join('/');
    const paths = folderPaths(entry, childRelDir);
    const key = `${childRelDir}\u0000${paths.localFsPath}\u0000${paths.remoteFsPath}`;
    let folder = folders.get(key);
    if (!folder) {
      folder = { kind: 'folder', status, relDir: childRelDir, ...paths, entries: [] };
      folders.set(key, folder);
    }
    folder.entries.push(entry);
  });

  const sortedFolders = Array.from(folders.values()).sort((a, b) =>
    upath.basename(a.relDir).localeCompare(upath.basename(b.relDir)) ||
    a.localFsPath.localeCompare(b.localFsPath)
  );
  files.sort((a, b) => a.entry.relPath.localeCompare(b.entry.relPath));
  return [...sortedFolders, ...files];
}

export default class CompareTreeDataProvider implements vscode.TreeDataProvider<CompareNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<CompareNode> = new vscode.EventEmitter<
    CompareNode
  >();
  readonly onDidChangeTreeData: vscode.Event<CompareNode> = this._onDidChangeTreeData.event;

  private _result: CompareResult | null = null;
  private _grouping: CompareGrouping;

  constructor(grouping: CompareGrouping = 'flat') {
    this._grouping = grouping;
  }

  get grouping(): CompareGrouping {
    return this._grouping;
  }

  get result(): CompareResult | null {
    return this._result;
  }

  setResult(result: CompareResult | null) {
    this._result = result;
    this._onDidChangeTreeData.fire();
  }

  setGrouping(grouping: CompareGrouping) {
    if (this._grouping === grouping) {
      return;
    }

    this._grouping = grouping;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: CompareNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const treeItem = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
      treeItem.description = String(this._entriesOf(node.status).length);
      // @types/vscode is pinned to 1.40, which predates the public ThemeIcon(id)
      // constructor (1.51); the runtime always has it (engines require >= 1.64)
      treeItem.iconPath = new (vscode.ThemeIcon as any)(GROUP_ICONS[node.status]);
      // per-status contextValue drives which group actions the menu offers
      // (see the compareGroup-* when-clauses in package.json).
      treeItem.contextValue = `compareGroup-${node.status}`;
      return treeItem;
    }

    if (node.kind === 'folder') {
      const treeItem = new vscode.TreeItem(
        upath.basename(node.relDir),
        vscode.TreeItemCollapsibleState.Collapsed
      );
      treeItem.iconPath = new (vscode.ThemeIcon as any)('folder');
      treeItem.tooltip = `${node.relDir} - ${STATUS_LABELS[node.status]}\nlocal: ${
        node.localFsPath
      }\nremote: ${node.remoteFsPath}`;
      treeItem.contextValue = `compareFolder-${node.status}`;
      return treeItem;
    }

    const entry = node.entry;
    const treeItem = new vscode.TreeItem(
      vscode.Uri.file(entry.localFsPath),
      vscode.TreeItemCollapsibleState.None
    );
    const separatorIndex = entry.relPath.lastIndexOf('/');
    treeItem.label = separatorIndex === -1 ? entry.relPath : entry.relPath.slice(separatorIndex + 1);
    treeItem.description =
      this._grouping === 'flat' && separatorIndex !== -1
        ? entry.relPath.slice(0, separatorIndex)
        : '';
    treeItem.tooltip = `${entry.relPath} - ${STATUS_LABELS[entry.status]}\nlocal: ${
      entry.localFsPath
    }\nremote: ${entry.remoteFsPath}`;
    treeItem.contextValue = `compareItem-${entry.status}`;
    // both Modified and TimeDiff open a diff on click - for TimeDiff it lets the
    // user confirm the content really is identical (an empty diff).
    if (entry.status === CompareStatus.Modified || entry.status === CompareStatus.TimeDiff) {
      treeItem.command = {
        command: COMMAND_COMPARE_DIFF,
        title: 'Diff with Remote',
        arguments: [node],
      };
    }
    return treeItem;
  }

  getChildren(node?: CompareNode): CompareNode[] {
    if (!node) {
      return GROUPS.filter(group => this._entriesOf(group.status).length > 0);
    }

    if (node.kind === 'group') {
      const entries = this._entriesOf(node.status);
      return this._grouping === 'flat'
        ? entries.map(entry => ({ kind: 'entry' as const, entry }))
        : comparePathChildren(entries, node.status);
    }

    if (node.kind === 'folder') {
      return comparePathChildren(node.entries, node.status, node.relDir);
    }

    return [];
  }

  private _entriesOf(status: CompareStatus): CompareEntry[] {
    if (!this._result) {
      return [];
    }
    return this._result.entries.filter(entry => entry.status === status);
  }
}

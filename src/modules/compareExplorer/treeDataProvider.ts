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

export type CompareNode = CompareGroup | CompareItem;

const GROUPS: CompareGroup[] = [
  { kind: 'group', status: CompareStatus.Modified, label: 'Modified' },
  { kind: 'group', status: CompareStatus.NewRemote, label: 'New Remote' },
  { kind: 'group', status: CompareStatus.NewLocal, label: 'New Local' },
];

const GROUP_ICONS = {
  [CompareStatus.Modified]: 'diff-modified',
  [CompareStatus.NewRemote]: 'cloud-download',
  [CompareStatus.NewLocal]: 'cloud-upload',
};

const STATUS_LABELS = {
  [CompareStatus.Modified]: 'Modified',
  [CompareStatus.NewRemote]: 'New Remote',
  [CompareStatus.NewLocal]: 'New Local',
};

export default class CompareTreeDataProvider implements vscode.TreeDataProvider<CompareNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<CompareNode> = new vscode.EventEmitter<
    CompareNode
  >();
  readonly onDidChangeTreeData: vscode.Event<CompareNode> = this._onDidChangeTreeData.event;

  private _result: CompareResult | null = null;

  get result(): CompareResult | null {
    return this._result;
  }

  setResult(result: CompareResult | null) {
    this._result = result;
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
      treeItem.contextValue = 'compareGroup';
      return treeItem;
    }

    const entry = node.entry;
    const treeItem = new vscode.TreeItem(
      vscode.Uri.file(entry.localFsPath),
      vscode.TreeItemCollapsibleState.None
    );
    const separatorIndex = entry.relPath.lastIndexOf('/');
    treeItem.label = separatorIndex === -1 ? entry.relPath : entry.relPath.slice(separatorIndex + 1);
    treeItem.description = separatorIndex === -1 ? '' : entry.relPath.slice(0, separatorIndex);
    treeItem.tooltip = `${entry.relPath} — ${STATUS_LABELS[entry.status]}\nlocal: ${
      entry.localFsPath
    }\nremote: ${entry.remoteFsPath}`;
    treeItem.contextValue = `compareItem-${entry.status}`;
    if (entry.status === CompareStatus.Modified) {
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
      return this._entriesOf(node.status).map(entry => ({ kind: 'entry' as const, entry }));
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

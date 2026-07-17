import * as vscode from 'vscode';
import { registerCommand, setContextValue } from '../../host';
import {
  COMMAND_COMPARE_CLEAR,
  COMMAND_COMPARE_GROUP_BY_PATH,
  COMMAND_COMPARE_REFRESH,
  COMMAND_COMPARE_SHOW_FLAT,
} from '../../constants';
import { reportError, simplifyPath } from '../../helper';
import { compareFiles, compareFolders, CompareResult } from '../../fileHandlers/compare';
import CompareTreeDataProvider, { CompareNode } from './treeDataProvider';

const GROUP_BY_PATH_STATE = 'sftp.compare.groupByPath';

export default class CompareExplorer {
  private _explorerView: vscode.TreeView<CompareNode>;
  private _treeDataProvider: CompareTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    const groupByPath = context.workspaceState.get<boolean>(GROUP_BY_PATH_STATE, false);
    this._treeDataProvider = new CompareTreeDataProvider(groupByPath ? 'path' : 'flat');
    setContextValue('compareGrouping', groupByPath ? 'path' : 'flat');

    this._explorerView = vscode.window.createTreeView('sftpCompare', {
      showCollapseAll: true,
      treeDataProvider: this._treeDataProvider,
    });
    context.subscriptions.push(this._explorerView);

    registerCommand(context, COMMAND_COMPARE_REFRESH, () => this._refresh());
    // setResult(null) is idempotent, so no guard is needed here (unlike
    // _refresh, which would re-run a compare against nothing).
    registerCommand(context, COMMAND_COMPARE_CLEAR, () => this.setResult(null));
    registerCommand(context, COMMAND_COMPARE_GROUP_BY_PATH, () =>
      this._setGroupByPath(context, true)
    );
    registerCommand(context, COMMAND_COMPARE_SHOW_FLAT, () =>
      this._setGroupByPath(context, false)
    );
  }

  get lastResult(): CompareResult | null {
    return this._treeDataProvider.result;
  }

  setResult(result: CompareResult | null) {
    this._treeDataProvider.setResult(result);
    this._explorerView.message = result
      ? `${simplifyPath(result.localRoot)} ↔ ${result.serviceName || result.remoteRoot}`
      : undefined;
  }

  private async _setGroupByPath(context: vscode.ExtensionContext, groupByPath: boolean) {
    await context.workspaceState.update(GROUP_BY_PATH_STATE, groupByPath);
    const grouping = groupByPath ? 'path' : 'flat';
    this._treeDataProvider.setGrouping(grouping);
    setContextValue('compareGrouping', grouping);
  }

  private async _refresh() {
    const result = this._treeDataProvider.result;
    if (!result) {
      return;
    }

    try {
      // Re-run the SAME scope the result came from. A file selection must not
      // widen into a full folder walk just because the user hit Refresh.
      if (result.origin.kind === 'files') {
        await compareFiles(result.origin.uris.map(uri => vscode.Uri.parse(uri)));
      } else {
        await compareFolders(vscode.Uri.file(result.origin.root));
      }
    } catch (error) {
      reportError(error);
    }
  }
}

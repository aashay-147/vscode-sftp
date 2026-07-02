import * as vscode from 'vscode';
import { registerCommand } from '../../host';
import { COMMAND_COMPARE_REFRESH } from '../../constants';
import { reportError, simplifyPath } from '../../helper';
import { compareFolders, CompareResult } from '../../fileHandlers/compare';
import CompareTreeDataProvider, { CompareNode } from './treeDataProvider';

export default class CompareExplorer {
  private _explorerView: vscode.TreeView<CompareNode>;
  private _treeDataProvider: CompareTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    this._treeDataProvider = new CompareTreeDataProvider();

    this._explorerView = vscode.window.createTreeView('sftpCompare', {
      showCollapseAll: true,
      treeDataProvider: this._treeDataProvider,
    });
    context.subscriptions.push(this._explorerView);

    registerCommand(context, COMMAND_COMPARE_REFRESH, () => this._refresh());
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

  private async _refresh() {
    const result = this._treeDataProvider.result;
    if (!result) {
      return;
    }

    try {
      await compareFolders(vscode.Uri.file(result.localRoot));
    } catch (error) {
      reportError(error);
    }
  }
}

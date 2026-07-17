import * as vscode from 'vscode';
import { EXTENSION_NAME } from './constants';

export function getOpenTextDocuments(): vscode.TextDocument[] {
  return vscode.workspace.textDocuments;
}

export function getUserSetting(section: string, resource?: vscode.Uri | null | undefined) {
  return vscode.workspace.getConfiguration(section, resource);
}

export function executeCommand(command: string, ...rest: any[]): Thenable<any> {
  return vscode.commands.executeCommand(command, ...rest);
}

export function onWillSaveTextDocument(
  listener: (e: vscode.TextDocumentWillSaveEvent) => any,
  thisArgs?: any
) {
  return vscode.workspace.onWillSaveTextDocument(listener, thisArgs);
}

export function onDidSaveTextDocument(listener: (e: vscode.TextDocument) => any, thisArgs?: any) {
  return vscode.workspace.onDidSaveTextDocument(listener, thisArgs);
}

export function onDidOpenTextDocument(listener: (e: vscode.TextDocument) => any, thisArgs?: any) {
  return vscode.workspace.onDidOpenTextDocument(listener, thisArgs);
}

export function pathRelativeToWorkspace(localPath) {
  return vscode.workspace.asRelativePath(localPath);
}

export function getActiveTextEditor() {
  return vscode.window.activeTextEditor;
}

export function getWorkspaceFolders() {
  return vscode.workspace.workspaceFolders;
}

export function refreshExplorer() {
  return executeCommand('workbench.files.action.refreshFilesExplorer');
}

export function focusOpenEditors() {
  return executeCommand('workbench.files.action.focusOpenEditorsView');
}

export function showTextDocument(uri: vscode.Uri, option?: vscode.TextDocumentShowOptions) {
  return vscode.window.showTextDocument(uri, option);
}

export function diffFiles(leftFsPath, rightFsPath, title, option?) {
  const leftUri = vscode.Uri.file(leftFsPath);
  const rightUri = vscode.Uri.file(rightFsPath);

  return executeCommand('vscode.diff', leftUri, rightUri, title, option);
}

export function promptForPassword(prompt: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    ignoreFocusOut: true,
    password: true,
    prompt,
  }) as Promise<string | undefined>;
}

export function setContextValue(key: string, value: any) {
  executeCommand('setContext', EXTENSION_NAME + '.' + key, value);
}

export function showErrorMessage(message: string, ...items: string[]) {
  return vscode.window.showErrorMessage(message, ...items);
}

export function showInformationMessage(message: string, ...items: string[]) {
  return vscode.window.showInformationMessage(message, ...items);
}

export function showWarningMessage(message: string, ...items: string[]) {
  return vscode.window.showWarningMessage(message, ...items);
}

export async function showConfirmMessage(
  message: string,
  confirmLabel: string = 'Yes',
  cancelLabel: string = 'No'
) {
  const result = await vscode.window.showInformationMessage(
    message,
    { title: confirmLabel },
    { title: cancelLabel }
  );

  return Boolean(result && result.title === confirmLabel);
}

// Modal (blocking) confirmation for destructive/irreversible actions. Unlike
// showConfirmMessage this uses a warning modal the user must explicitly dismiss.
export async function showConfirmMessageModal(message: string, confirmLabel: string = 'Yes') {
  const result = await vscode.window.showWarningMessage(message, { modal: true }, confirmLabel);
  return result === confirmLabel;
}

// Modal with an arbitrary set of action buttons (plus VS Code's built-in
// Cancel). Resolves to the chosen label, or undefined on Cancel/dismiss.
export async function showModalChoices(
  message: string,
  ...actions: string[]
): Promise<string | undefined> {
  return vscode.window.showWarningMessage(message, { modal: true }, ...actions);
}

// Cancellable indeterminate progress notification. The task receives a
// callback to update the message and an isCancelled probe.
export function showCancellableProgress<T>(
  title: string,
  task: (report: (message: string) => void, isCancelled: () => boolean) => Promise<T>
): Thenable<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    (progress, token) =>
      task(message => progress.report({ message }), () => token.isCancellationRequested)
  );
}

// Cancellable determinate progress notification for a transfer operation.
// The task receives a reporter for {message, increment} updates and an
// onCancel registrar; the notification closes when the task settles.
export function showTransferProgress<T>(
  title: string,
  task: (
    report: (update: { message?: string; increment?: number }) => void,
    onCancel: (callback: () => void) => void
  ) => Promise<T>
): Thenable<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    (progress, token) =>
      task(
        update => progress.report(update),
        callback => {
          token.onCancellationRequested(() => callback());
        }
      )
  );
}

export function showOpenDialog(options: vscode.OpenDialogOptions) {
  return vscode.window.showOpenDialog(options);
}

export function openFolder(uri?: vscode.Uri, newWindow?: boolean) {
  return executeCommand('vscode.openFolder', uri, newWindow);
}

export function registerCommand(
  context: vscode.ExtensionContext,
  name: string,
  callback: (...args: any[]) => any,
  thisArg?: any
) {
  const disposable = vscode.commands.registerCommand(name, callback, thisArg);
  context.subscriptions.push(disposable);
}

export function addWorkspaceFolder(...workspaceFoldersToAdd: { uri: vscode.Uri; name?: string }[]) {
  return vscode.workspace.updateWorkspaceFolders(0, 0, ...workspaceFoldersToAdd);
}

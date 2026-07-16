import * as vscode from 'vscode';
import * as path from 'path';
import { COMMAND_UPLOAD_CHANGEDFILES } from '../constants';
import { getFileService } from '../modules/serviceManager';
import { uploadFile, renameRemote, removeRemote } from '../fileHandlers';
import { getGitService, GitAPI, Repository, Status, Change } from '../modules/git';
import { showConfirmMessageModal } from '../host';
import { checkCommand } from './abstract/createCommand';
import logger from '../logger';
import { simplifyPath } from '../helper';

export default checkCommand({
  id: COMMAND_UPLOAD_CHANGEDFILES,

  async handleCommand(hint: any) {
    return handleCommand(hint);

    // resourceGroup.resourceStates.forEach(resourceState => {
    //   resourceState.
    //   console.log(resourceState.decorations);
    // });

    // try {
    //   await uploadFile(ctx, { ignore: null });
    // } catch (error) {
    //   // ignore error when try to upload a deleted file
    //   if (error.code !== 'ENOENT') {
    //     throw error;
    //   }
    // }
  },
});

function isRepository(object: any): object is Repository {
  return 'rootUri' in object;
}

function isSourceControlResourceGroup(object: any): object is vscode.SourceControlResourceGroup {
  return 'id' in object && 'resourceStates' in object;
}

async function handleCommand(hint: any) {
  let repository: Repository | undefined;
  let filterGroupId;
  const git = getGitService();

  if (!hint) {
    repository = await getRepository(git);
  } else if (isSourceControlResourceGroup(hint)) {
    repository = git.repositories.find(repo => repo.ui.selected);
    filterGroupId = hint.id;
  } else if (isRepository(hint)) {
    repository = git.repositories.find(repo => repo.ui.selected);
  }

  if (!repository) {
    return;
  }

  let changes: Change[];
  if (filterGroupId === 'index') {
    changes = repository.state.indexChanges;
  } else if (filterGroupId === 'workingTree') {
    changes = repository.state.workingTreeChanges;
  } else {
    changes = repository.state.indexChanges.concat(repository.state.workingTreeChanges);
  }

  const creates: Change[] = [];
  const uploads: Change[] = [];
  const renames: Change[] = [];
  const deletes: Change[] = [];
  let confirmOverwrite = false;
  for (const change of changes) {
    const fileService = getFileService(change.uri);
    if (!fileService) {
      continue;
    }
    confirmOverwrite = confirmOverwrite || Boolean(fileService.getConfig().confirmOverwrite);

    switch (change.status) {
      case Status.INDEX_MODIFIED:
      case Status.MODIFIED:
        uploads.push(change);
        break;
      case Status.INDEX_ADDED:
      case Status.UNTRACKED:
        creates.push(change);
        break;
      case Status.INDEX_RENAMED:
        renames.push(change);
        break;
      case Status.INDEX_DELETED:
      case Status.DELETED:
        deletes.push(change);
        break;
      default:
        break;
    }
  }

  // One batched confirm for the whole run, then per-uri confirmOverwrite: false
  // so the per-file gate stays silent. Interim until staged classification
  // (Phase 2): the wording is status-neutral because nothing here verified that
  // any destination file actually exists.
  const uploadCount = creates.length + uploads.length;
  if (confirmOverwrite && uploadCount > 0) {
    const ok = await showConfirmMessageModal(
      `Upload ${uploadCount} changed file${uploadCount > 1 ? 's' : ''}? ` +
        'Destination files may be replaced.'
    );
    if (!ok) {
      return;
    }
  }

  await Promise.all(
    creates.concat(uploads).map(change =>
      uploadFile(change.uri, { confirmOverwrite: false }).catch(e => {
        logger.error('Upload failed.', e);
      })
    )
  );
  await Promise.all(
    renames.map(change =>
      renameRemote(change.originalUri, { originPath: change.renameUri!.fsPath }).catch(e => {
        logger.error('Rename failed.', e);
      })
    )
  );
  await Promise.all(
    deletes.map(change =>
      removeRemote(change.uri).catch(e => {
        logger.error('Deletion failed.', e);
      })
    )
  );

  logger.log('');
  logger.log('------ Upload Changed Files Result ------');
  outputGroup('create', creates, c => simplifyPath(c.uri.fsPath));
  outputGroup('upload', uploads, c => simplifyPath(c.uri.fsPath));
  outputGroup(
    'renamed',
    renames,
    c => `${simplifyPath(c.originalUri.fsPath)} ➞ ${simplifyPath(c.renameUri!.fsPath)}`
  );
  outputGroup('deleted', deletes, c => simplifyPath(c.uri.fsPath));
}

function outputGroup<T>(label: string, items: T[], formatItem: (x: T) => string) {
  if (items.length <= 0) {
    return;
  }

  logger.log(`${label.toUpperCase()}:`);
  logger.log(items.map(i => formatItem(i)).join('\n'));
  logger.log('');
}

async function getRepository(git: GitAPI): Promise<Repository | undefined> {
  if (git.repositories.length === 1) {
    return git.repositories[0];
  }

  if (git.repositories.length === 0) {
    throw new Error('There are no available repositories');
  }

  const picks = git.repositories.map(repo => {
    const label = path.basename(repo.rootUri.fsPath);
    const description = repo.state.HEAD ? repo.state.HEAD.name : '';

    return {
      label,
      description,
      repository: repo,
    };
  });

  const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Choose a repository' });

  return pick && pick.repository;
}

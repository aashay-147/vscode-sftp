import { CompareStatus } from '../fileHandlers/compare';
import { CompareNode } from '../modules/compareExplorer';

export interface CompareNodeTarget {
  localFsPath: string;
  remoteFsPath: string;
  isDirectory: boolean;
  status: CompareStatus;
  relPath: string;
}

export function compareNodeTarget(node: CompareNode): CompareNodeTarget | undefined {
  if (!node) {
    return;
  }

  if (node.kind === 'entry') {
    return { ...node.entry, isDirectory: false };
  }

  if (node.kind === 'folder') {
    return {
      localFsPath: node.localFsPath,
      remoteFsPath: node.remoteFsPath,
      isDirectory: true,
      status: node.status,
      relPath: node.relDir,
    };
  }
}

export function canRevealCompareLocal(status: CompareStatus): boolean {
  return status !== CompareStatus.NewRemote;
}

export function canRevealCompareRemote(status: CompareStatus): boolean {
  return status !== CompareStatus.NewLocal;
}

export function canDeleteCompareRemote(status: CompareStatus): boolean {
  return status === CompareStatus.NewRemote;
}

export function canDeleteCompareLocal(status: CompareStatus): boolean {
  return status === CompareStatus.NewLocal;
}

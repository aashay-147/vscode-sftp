jest.mock('vscode', () => ({
  EventEmitter: class {
    readonly event = () => undefined;
    fire() {
      return;
    }
  },
}));

jest.mock('../../../fileHandlers/compare', () => ({
  CompareStatus: {
    NewLocal: 'newLocal',
    NewRemote: 'newRemote',
    Modified: 'modified',
    TimeDiff: 'timeDiff',
  },
}));

import { CompareStatus } from '../../../fileHandlers/compare';
import {
  canDeleteCompareLocal,
  canDeleteCompareRemote,
  canRevealCompareLocal,
  canRevealCompareRemote,
  compareNodeTarget,
} from '../../../commands/compareNode';
import CompareTreeDataProvider, {
  comparePathChildren,
  CompareFolder,
  CompareGroup,
  CompareItem,
} from '../treeDataProvider';

function entry(
  relPath: string,
  localFsPath: string,
  remoteFsPath: string,
  status: CompareStatus = CompareStatus.NewRemote
) {
  return { relPath, localFsPath, remoteFsPath, status };
}

describe('CompareTreeDataProvider path grouping', () => {
  test('nests by immediate path segment with folders before root files', () => {
    const entries = [
      entry('root.txt', '/local/root.txt', '/remote/root.txt'),
      entry('src/api/b.ts', '/local/src/api/b.ts', '/remote/src/api/b.ts'),
      entry('docs/readme.md', '/local/docs/readme.md', '/remote/docs/readme.md'),
      entry('src/api/a.ts', '/local/src/api/a.ts', '/remote/src/api/a.ts'),
    ];

    const root = comparePathChildren(entries, CompareStatus.NewRemote);
    expect(root.map(node => node.kind)).toEqual(['folder', 'folder', 'entry']);
    expect((root[0] as CompareFolder).relDir).toBe('docs');
    expect((root[1] as CompareFolder).relDir).toBe('src');
    expect((root[2] as CompareItem).entry.relPath).toBe('root.txt');

    const src = root[1] as CompareFolder;
    expect(src.localFsPath).toBe('/local/src');
    expect(src.remoteFsPath).toBe('/remote/src');
    expect(src.entries).toHaveLength(2);

    const srcChildren = comparePathChildren(src.entries, src.status, src.relDir);
    expect(srcChildren).toHaveLength(1);
    const api = srcChildren[0] as CompareFolder;
    expect(api.relDir).toBe('src/api');
    expect(api.localFsPath).toBe('/local/src/api');
    expect(api.remoteFsPath).toBe('/remote/src/api');

    const apiChildren = comparePathChildren(api.entries, api.status, api.relDir);
    expect(apiChildren.map(node => (node as CompareItem).entry.relPath)).toEqual([
      'src/api/a.ts',
      'src/api/b.ts',
    ]);
  });

  test('does not merge equal relative folders from different roots', () => {
    const root = comparePathChildren([
      entry('src/a.ts', '/one/src/a.ts', '/remote-one/src/a.ts'),
      entry('src/b.ts', '/two/src/b.ts', '/remote-two/src/b.ts'),
    ], CompareStatus.NewRemote);

    expect(root).toHaveLength(2);
    expect(root.every(node => node.kind === 'folder')).toBe(true);
    expect((root[0] as CompareFolder).localFsPath).not.toBe(
      (root[1] as CompareFolder).localFsPath
    );
  });

  test('switches presentation without replacing the compare result', () => {
    const provider = new CompareTreeDataProvider('flat');
    const result = {
      localRoot: '/local',
      remoteRoot: '/remote',
      serviceName: 'test',
      origin: { kind: 'folder' as const, uri: 'file:///local' },
      entries: [entry('src/a.ts', '/local/src/a.ts', '/remote/src/a.ts')],
    };
    provider.setResult(result);

    const group = provider.getChildren()[0] as CompareGroup;
    expect(provider.getChildren(group)[0].kind).toBe('entry');

    provider.setGrouping('path');
    expect(provider.grouping).toBe('path');
    expect(provider.result).toBe(result);
    expect(provider.getChildren(group)[0].kind).toBe('folder');
  });
});

describe('Folder Compare node actions', () => {
  const compareEntry = entry(
    'src/a.ts',
    '/local/src/a.ts',
    '/remote/src/a.ts',
    CompareStatus.Modified
  );
  const item: CompareItem = { kind: 'entry', entry: compareEntry };
  const folder: CompareFolder = {
    kind: 'folder',
    status: CompareStatus.Modified,
    relDir: 'src',
    localFsPath: '/local/src',
    remoteFsPath: '/remote/src',
    entries: [compareEntry],
  };

  test('resolves file and folder targets but not group headers', () => {
    expect(compareNodeTarget(item)).toEqual({ ...compareEntry, isDirectory: false });
    expect(compareNodeTarget(folder)).toEqual({
      localFsPath: '/local/src',
      remoteFsPath: '/remote/src',
      isDirectory: true,
      status: CompareStatus.Modified,
      relPath: 'src',
    });
    expect(compareNodeTarget({
      kind: 'group',
      status: CompareStatus.Modified,
      label: 'Modified',
    })).toBeUndefined();
  });

  test('enforces the reveal and delete status matrix', () => {
    expect(canRevealCompareLocal(CompareStatus.NewLocal)).toBe(true);
    expect(canRevealCompareLocal(CompareStatus.NewRemote)).toBe(false);
    expect(canRevealCompareRemote(CompareStatus.NewRemote)).toBe(true);
    expect(canRevealCompareRemote(CompareStatus.NewLocal)).toBe(false);
    expect(canRevealCompareLocal(CompareStatus.Modified)).toBe(true);
    expect(canRevealCompareRemote(CompareStatus.TimeDiff)).toBe(true);

    expect(canDeleteCompareRemote(CompareStatus.NewRemote)).toBe(true);
    expect(canDeleteCompareRemote(CompareStatus.Modified)).toBe(false);
    expect(canDeleteCompareLocal(CompareStatus.NewLocal)).toBe(true);
    expect(canDeleteCompareLocal(CompareStatus.TimeDiff)).toBe(false);
  });
});

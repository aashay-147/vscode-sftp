import * as path from 'path';
import { diffFiles } from '../host';
import { EXTENSION_NAME } from '../constants';
import { fileOperations, TransferDirection } from '../core';
import { makeTmpFile } from '../helper';
import createFileHandler from './createFileHandler';
import { resolveEffectiveTarget } from './transfer/downloadTarget';

export const diff = createFileHandler({
  name: 'diff',
  async handle() {
    // Feature 9: inverse remap only - LOCAL_TO_REMOTE keeps the local side
    // literal, so a mirror file diffs against its true remote counterpart and
    // everything else is untouched. diff has no implicit callers, so the flag
    // is applied unconditionally here.
    this.target = resolveEffectiveTarget(
      this,
      { useLocalDownloadPath: true },
      TransferDirection.LOCAL_TO_REMOTE
    );
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath, remoteFsPath } = this.target;
    const tmpPath = await makeTmpFile({
      prefix: `${EXTENSION_NAME}-`,
      postfix: path.extname(localFsPath),
    });

    await fileOperations.transferFile(remoteFsPath, tmpPath, remoteFs, localFs);
    await diffFiles(
      tmpPath,
      localFsPath,
      `${path.basename(localFsPath)} (${this.fileService.name || 'remote'} ↔ local)`
    );
  },
});

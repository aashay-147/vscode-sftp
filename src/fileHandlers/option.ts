export interface FileHandleOption {
  ignore?: ((filepath: string) => boolean) | null;
  // When truthy, an explicit upload/download prompts before overwriting an
  // existing destination file. `true` and `'confirm'` are synonyms (prompt only
  // when the destination exists). Default (falsy) preserves silent overwrite
  // with zero extra round-trip. Threaded from config per-profile.
  confirmOverwrite?: boolean | 'confirm';
  // When true, explicit folder/project/multi-file transfers skip files already
  // identical on the destination (same basis as Sync/Compare; size-only on
  // FTP). Single-file targets are exempt — transferring the one named file is
  // the point. Threaded from config per-profile.
  skipUnmodified?: boolean;
  // When true, hitting the ignore gate shows an info toast instead of silently
  // doing nothing. Passed only by explicit commands — an unconditional toast
  // would fire on every uploadOnSave of an ignored file and per ignored
  // subfolder under Sync.
  notifyIgnored?: boolean;
  // Internal, call-site only (Feature 5): suppress the per-operation progress
  // notification. Set on implicit paths (uploadOnSave, downloadOnOpen, watcher
  // autoUpload, Edit in Local) so background transfers keep the plain
  // status-bar spinner and never pop UI.
  _noProgress?: boolean;
}

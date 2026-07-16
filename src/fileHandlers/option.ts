export interface FileHandleOption {
  ignore?: ((filepath: string) => boolean) | null;
  // When truthy, an explicit upload/download prompts before overwriting an
  // existing destination file. `true` and `'confirm'` are synonyms (prompt only
  // when the destination exists). Default (falsy) preserves silent overwrite
  // with zero extra round-trip. Threaded from config per-profile.
  confirmOverwrite?: boolean | 'confirm';
  // When true, hitting the ignore gate shows an info toast instead of silently
  // doing nothing. Passed only by explicit commands — an unconditional toast
  // would fire on every uploadOnSave of an ignored file and per ignored
  // subfolder under Sync.
  notifyIgnored?: boolean;
}

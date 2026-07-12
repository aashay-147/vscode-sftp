export interface FileHandleOption {
  ignore?: ((filepath: string) => boolean) | null;
  // When truthy, an explicit upload/download prompts before overwriting an
  // existing destination file. `true` and `'confirm'` are synonyms (prompt only
  // when the destination exists). Default (falsy) preserves silent overwrite
  // with zero extra round-trip. Threaded from config per-profile.
  confirmOverwrite?: boolean | 'confirm';
}

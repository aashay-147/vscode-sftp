# Round 2 Plan — `downloadPath` as a true local mirror

> Status: PLANNED — deferred, reimplement FROM SCRATCH. Not yet implemented.
> Validated in local testing (2026-07-02): connect works (after eda66f4), downloads
> honor `downloadPath` incl. per-profile override — but compare data was wrong and
> uploads ignored the mirror (findings below).
>
> **2026-07-05: Feature 1 (`downloadPath`) was reverted out of `integration`** rather
> than fixed forward. `integration` is now `fix/build-baseline` + `feat/folder-compare`
> only. The old first-attempt code is preserved on branch `feat/download-path`, but
> this round-2 work supersedes it — start a fresh `feat/download-path-v2` off the
> current `integration` and implement the mirror semantics below (the old §A resolver
> can be salvaged, but §B/C/D/E assume they are being built anew, not patched onto
> the reverted code). Re-add the 6 downloadPath unit tests as part of §F.

## Diagnosis

Both reported problems share one root cause: **`downloadPath` currently affects only
the *target* of downloads.** Everything else — folder compare, diff, and all upload
commands — still uses the original workspace↔`remotePath` mapping.

1. **Compare data "incorrect"**: comparing remote `/upload/SFC` walks the
   workspace-mapped local twin `/workspace/SFC`, which doesn't exist — the files were
   downloaded to `/workspace/_downloads/SFC`. So everything reports **New Remote**
   even though it exists locally.
2. **Upload goes to remote root**: any file in the workspace can be right-click
   uploaded to its workspace-mapped remote location (`/workspace/README.md` →
   `/upload/README.md`). Worse, uploading a file from *inside* `_downloads` would go
   to `/upload/_downloads/...`.

## Design principle

When `downloadPath` is set, it defines a **local mirror** of `remotePath` for
*explicit* transfer commands, bidirectionally:

- remote → local (download target): `remoteFsPath` ↦ `downloadPathBase + rel(remotePath, remoteFsPath)` — already shipped (F1).
- local → remote (upload / re-download / compare / diff, when the local path is
  *under* the base): `localFsPath` ↦ `remotePath + rel(base, localFsPath)` — **new inverse mapping**.
- The side the user explicitly clicked is taken literally; the *other* side is
  derived via the mirror-aware mapping.
- `uploadOnSave`, the file watcher, and sync commands keep upstream mapping
  (no `useDownloadPath` flag) — sync is a workspace-mirroring workflow by design.

## Changes

### A. Mapping module — branch `feat/download-path`
`src/fileHandlers/transfer/downloadTarget.ts`:
- factor out `getDownloadPathBase(ctx): string | undefined` (resolve `~/`, relative-to-baseDir, absolute)
- add `isUnderDownloadPath(ctx, localFsPath): boolean`
- add `resolveRemoteFsPathFromDownloadPath(ctx, localFsPath): string | null`
  (inverse mapping; `null` when no `downloadPath` or path not under base)
All pure, unit-testable, no new imports that could recreate the circular-import problem.

### B. Transfer-direction fixes — `feat/download-path`
`createTransferHandle` in `src/fileHandlers/transfer/index.ts`, when
`option.useDownloadPath && downloadPath` is set:
- **REMOTE_TO_LOCAL**: if `localFsPath` is under the base → the ctx was built from a
  mirror-local uri; use `srcFsPath = inverse(localFsPath)` (true remote) and
  `targetFsPath = localFsPath` (re-download in place). Otherwise keep current
  forward redirect behavior.
- **LOCAL_TO_REMOTE** (flag newly passed by explicit upload commands): if
  `localFsPath` under base → `targetFsPath = inverse(localFsPath)` so
  `_downloads/SFC/x.xlsx` uploads to `/upload/SFC/x.xlsx`, never
  `/upload/_downloads/...`. Outside the base → unchanged (subject to guard C).

Add `useDownloadPath: true` to explicit upload commands: `upload`, `uploadFile`,
`uploadFolder`, `uploadActiveFile`, `uploadActiveFolder`, `uploadForce`, and the
`ToAllProfiles` variants. (`uploadProject` stays workspace-scoped.)

### C. Upload guard + new config — `feat/download-path`
New option `restrictUploadsToDownloadPath` (boolean, default `false`):
- Joi rule in `src/modules/config.ts`, property in `schema/definitions.json`
  (per-profile override is free via `mergeProfile`).
- When `true` **and** `downloadPath` is set: explicit local→remote commands
  (all upload commands above **plus** `sync.localToRemote` / `sync.bothDirections`)
  abort with a clear warning when the target is outside the base:
  `"<path> is outside downloadPath (<base>) — upload blocked by restrictUploadsToDownloadPath"`.
- Implemented as a shared pre-check helper used by the command `handleFile`s
  (not inside the transfer layer, so internal callers are unaffected).

### D. Menu visibility (finding 2.1) — `feat/download-path`, best-effort
VS Code `when` clauses are static; they cannot test "resource is under a
config-defined folder" directly. Plan:
- Maintain context keys via `setContext`:
  - `sftp.uploadRestricted` (bool — any active config has the restriction on)
  - `sftp.uploadableDirs` (object keyed by absolute dir paths currently under any
    config's `downloadPath` base)
- Upload/sync menu items get:
  `"when": "sftp.enabled && (!sftp.uploadRestricted || resourceDirname in sftp.uploadableDirs) && ..."`.
- Refresh the dir enumeration on activation, config change, and after each
  download/compare refresh (cheap re-scan of the base).
- Documented caveats: a brand-new dir appears in the menu after the next refresh;
  guard C remains the reliable backstop. Vanilla users (restriction off) see
  zero behavior change.

### E. Compare mapping — `integration` (cross-feature, like eddf1e8)
`src/fileHandlers/compare.ts`:
- Factor a pure `deriveCompareRoots(config, target): {localRoot, remoteRoot}`:
  - invoked on a **remote** folder, or a local folder **under** the base →
    `localRoot` = mirror-local of `remoteRoot` (forward map into `downloadPath`)
  - invoked on a local folder **outside** the base (or no `downloadPath`) →
    current behavior (literal local, workspace-mapped remote)
- Walk the local side at the derived root; entry `localFsPath`s live under it.
- **Compare item commands** (`compare.diff`, `compare.download`, `compare.upload`):
  stop deriving one side from the other via `handleCtxFromUri`. Build an explicit
  ctx instead — `createFileHandler` already accepts a full `FileHandlerContext`, and
  `UResource.from(Uri.file(entry.localFsPath), { localBasePath: result.localRoot,
  remoteBasePath: result.remoteRoot, ... })` yields an exact pair. This removes the
  whole class of mapping bugs for compare actions and drops the need for the
  `useDownloadPath` flag there (supersedes eddf1e8's approach).
- Edge case: absolute `downloadPath` outside the workspace — resolve the
  `FileService` from the compare result's stored service id, not from the local uri.

### F. Tests
- Unit tests for `getDownloadPathBase` / inverse mapping (relative, absolute, `~/`,
  not-under-base → null, exact-base-root).
- Extend `downloadPath-test.ts` with LOCAL_TO_REMOTE inverse cases.
- Unit tests for `deriveCompareRoots` (remote-origin, local-under-base,
  local-outside-base, no downloadPath).

### G. Docs
README + `docs/configuration.md`: rewrite `downloadPath` as "local mirror"
semantics; document `restrictUploadsToDownloadPath` and the menu-visibility caveat.

## Branch / commit strategy
1. A–D as commits on `feat/download-path`, push.
2. Merge `feat/download-path` → `integration`.
3. E (+ its tests) on `integration` (depends on both features; keeps
   `feat/folder-compare` independently PR-able upstream without downloadPath).
4. Rebuild VSIX from `integration`.

## Verification checklist
- webpack dev+prod clean; jest 47/48 + new tests (offset failure is pre-existing upstream).
- Manual: compare remote `SFC` → files show as unchanged/Modified, not New Remote;
  download from compare view lands in `_downloads` and refresh clears the row;
  upload `_downloads/SFC/x.xlsx` → arrives at `/upload/SFC/x.xlsx`;
  with `restrictUploadsToDownloadPath: true`, upload on `README.md` is blocked
  (and hidden from the menu after context refresh);
  config without `downloadPath` behaves exactly like upstream.

## Defaults chosen (flag if you disagree)
1. Inverse mapping is **automatic** whenever `downloadPath` is set (explicit
   commands only) — no extra flag; uploading a mirror file to
   `/upload/_downloads/...` is never what anyone wants.
2. `restrictUploadsToDownloadPath` defaults **false** (upstream-friendly); set it
   `true` in your `sftp.json` / profiles.
3. Sync commands are included in the guard (C) when restriction is on, but never
   get inverse mapping — they remain workspace-mirroring by design.

# Plan: Fork Natizyskunk/vscode-sftp + Folder Compare & Configurable Download Location

> **Validated against the codebase 2026-07-02. EXECUTED 2026-07-02.** Implemented as
> planned on local branches: `fix/build-baseline` (baseline repairs, one commit each,
> PR-able), `feat/download-path` (Feature 1 + 6 unit tests), `feat/folder-compare`
> (Feature 2). Pushed to the fork `origin` (github.com.heu.io:aashay-147/vscode-sftp).
>
> **UPDATE 2026-07-05 — local testing findings + downloadPath DEFERRED.**
> Local F5/VSIX testing surfaced (1) an upstream SSH crash and (2) that `downloadPath`
> is only a half-mirror (downloads redirect, but compare + uploads still use the
> workspace↔remotePath map). Actions taken:
> - Added a 4th baseline repair `eda66f4` (SSH close/end listener — wraps
>   `this.end()` in arrow fns; upstream `develop` is unshippable without it).
> - **Reverted Feature 1 (`downloadPath`) out of `integration`.** `integration` was
>   rebuilt as `fix/build-baseline` + `feat/folder-compare` only (merge `2e702c4`,
>   force-pushed). The `feat/download-path` branch is preserved on `origin` for
>   reference, but downloadPath will be **reimplemented from scratch** with true
>   bidirectional "local mirror" semantics — see `fix-round2-plan.md`.
> Verified on the rebuilt `integration`: webpack dev+prod 0 errors; tests 41/42 (the
> one failure is the pre-existing upstream `remoteTimeOffsetInHours` bug; the count
> dropped from 47/48 because the 6 downloadPath tests left with the feature). VSIX
> repackaged (0 downloadPath refs in bundle). Checkout left on `integration`.
> Still pending (user actions): the light rebrand in package.json (needs a marketplace
> publisher id) before any Marketplace publish; downloadPath round-2 implementation.

## Context

We want our own SFTP extension for VS Code with two new capabilities on top of an
existing, actively-maintained base:

1. **Folder Compare & diffs** — a way to compare a local folder against its remote
   counterpart and see, per file: *New Remote*, *New Local*, or *Modified* (differs
   on both sides), with click-to-diff.

2. **Configurable download location** — let the user decide, in config, where
   downloads land locally, independent of the working `context` folder — settable
   **per profile**.

### Key research finding (changes the original premise)

The user originally wanted to build on `thebestbradley/vscode-sftp-plus` for its
"Settings GUI". **That GUI does not exist in code.** On its `master` branch the
plus fork is only 9 commits ahead of Natizyskunk, and *every one of those commits
touches only `README.md`/`CHANGELOG.md`*. Proxy work exists on unmerged branches but no GUI.

**Decisions (confirmed with user):**

- Base: **fork `Natizyskunk/vscode-sftp` directly** (the real upstream). Settings GUI deferred to a later phase.
- Download location: **new per-profile config field** that redirects downloads, preserving remote subfolder structure.
- Folder compare UI: **dedicated compare tree view** (like Git's Changes), click-to-diff.
- **Upstream contribution matters** → keep changes modular/additive, maintain an `upstream` remote, design features as self-contained modules that can be submitted as PRs.

### Base architecture (verified)

- `ssh2` + `ftp` libs; TypeScript + Webpack 5; Jest tests. Entry `src/extension.ts`.
- Commands auto-registered via `require.context()` in [src/initCommands.ts](src/initCommands.ts):
  files named `command*.ts` / `fileCommand*.ts` / `fileMultiCommand*.ts` **directly in
  `src/commands/` (non-recursive)** are discovered, built with
  `createCommand`/`createFileCommand`/`createFileMultiCommand` from
  `src/commands/abstract/createCommand.ts`, and each command's `id`/title must be added
  to `contributes.commands` in `package.json`.

- Config: `.vscode/sftp.json`. Joi `configScheme` + `defaultConfig` in
  [src/modules/config.ts](src/modules/config.ts) (`allowUnknown: true`, so new fields
  don't break old validation). Editor IntelliSense comes from
  `contributes.jsonValidation` → [schema/config.schema.json](schema/config.schema.json),
  with shared properties in [schema/definitions.json](schema/definitions.json) — **new
  config fields must be added there too**.

- Profiles: `profiles` + `defaultProfile`; `mergeProfile()`
  ([src/core/fileService.ts:344](src/core/fileService.ts#L344)) overlays profile fields
  over base fields — **every key is overridden except `ignore`, which is concatenated** —
  so any new scalar field is per-profile-overridable for free.

- Path mapping: `UResource.from()` in [src/core/uResource.ts](src/core/uResource.ts) computes
  `localFsPath = toLocalPath(remoteFsPath, remoteBasePath, localBasePath)` (and inverse),
  where `toLocalPath`/`toRemotePath` live in `src/helper/paths.ts`. `localBasePath` is the
  **resolved** context: `serviceManager.getBasePath()` does `path.join(workspace, context)`
  (deliberately not `path.resolve` — see the Windows-root comment in
  [src/modules/serviceManager/index.ts](src/modules/serviceManager/index.ts)); inside any
  file handler it's available as `this.fileService.baseDir`.

- File handlers run with a `FileHandlerContext` (`this.target: UResource`,
  `this.fileService: FileService`, `this.config: ServiceConfig`), built by
  `handleCtxFromUri(uri)` (exported from `src/fileHandlers`). FS access is via
  **methods on the service**: `this.fileService.getLocalFileSystem()` /
  `this.fileService.getRemoteFileSystem(this.config)`.

- Transfer: [src/fileHandlers/transfer/index.ts](src/fileHandlers/transfer/index.ts) exposes
  `download`/`downloadFile`/`downloadFolder` via `createFileHandler` + a shared
  `downloadHandle` from `createTransferHandle(TransferDirection.REMOTE_TO_LOCAL)`;
  destination is `targetFsPath: localFsPath` (from `this.target`). Folder walking is inside
  `transfer()` (`transfer.ts`), which calls `targetFs.ensureDir()` per folder.
  ⚠️ `downloadHandle`-backed `downloadFile` is **also** called by `downloadOnOpen`
  ([src/modules/fileActivityMonitor.ts:77](src/modules/fileActivityMonitor.ts#L77)) and
  "Edit in Local" ([src/commands/fileCommandEditInLocal.ts](src/commands/fileCommandEditInLocal.ts),
  which opens `ctx.target.localUri` right after downloading) — these must keep writing to
  the context-mapped path.

- Modified-file test used by sync: `isFileModified()`
  ([src/fileHandlers/transfer/transfer.ts:60-63](src/fileHandlers/transfer/transfer.ts#L60-L63)):
  mtime differs at **second granularity** OR size differs. `remoteTimeOffsetInHours` is
  applied inside the remote FS layer
  ([src/core/fs/remoteFileSystem.ts](src/core/fs/remoteFileSystem.ts) `toLocalTime`/
  `toRemoteTimeInSecnonds`), so `list`/`lstat` results arrive already offset-adjusted —
  consumers must not re-apply the offset.

- **Already exists (do not rebuild):** single-file diff (`sftp.diff`,
  [src/fileHandlers/diff.ts](src/fileHandlers/diff.ts) → tmp remote copy + `diffFiles`),
  sync commands (`sftp.sync.*`), and the Remote Explorer tree
  ([src/modules/remoteExplorer/](src/modules/remoteExplorer/)): view id `remoteExplorer`
  in activity-bar container `sftp`, gated by `when: sftp.enabled`.

---

## Phase 0 — Fork & repo setup

**Current state:** repo is already cloned at the workspace root, remote `upstream` →
`https://github.com/Natizyskunk/vscode-sftp.git`, branch `develop` checked out,
`npm install` done.

1. ~~Clone base~~ **Done.**
2. Remotes: `upstream` is set. **Remaining:** create the GitHub fork and
   `git remote add origin <fork-url>`.

3. **Line endings — done.** The working tree is CRLF (WSL2/Windows mount) while the
   index is LF, which made all 145 files look modified. Fixed with
   `git config core.autocrlf true` (working tree stays CRLF, commits stay LF,
   `git status` is clean). **Never commit CRLF** — if status suddenly shows mass
   modifications again, check this setting before committing.

4. **Baseline repairs — specified & validated; worktree reverted to pristine.**
   Upstream `develop` HEAD (4dece7b, v1.16.3+46) does not compile and its tests cannot
   run — it has no build CI, so PRs get merged unbuilt. The three fixes below were
   applied and verified on 2026-07-02, then reverted so no code changes exist during
   planning. **Reapplying them is the first execution step** (on a `fix/build-baseline`
   branch off `develop`, before any feature branch); each is a candidate first PR to
   upstream:
   - [src/commands/abstract/createCommand.ts](src/commands/abstract/createCommand.ts):
     add the missing import of `COMMAND_UPLOAD_FILE_TO_ALL_PROFILES` /
     `COMMAND_UPLOAD_FOLDER_TO_ALL_PROFILES` from `../../constants` (4 TS errors,
     introduced by upstream PR #408).
   - [src/helper/paths.ts](src/helper/paths.ts): revert the unreleased
     `getFileSystemPath()`/`vscode-uri` casing change to the released v1.16.3 form
     (drop the `fs`/`vscode-uri` imports and `getFileSystemPath()`; `toRemotePath` goes
     back to `upath.join(remoteContext, path.relative(localContext, localPath))`).
     It fails to compile (`vscode-uri@1.x` has no named `URI` export), and — masked by
     that compile error — passes plain strings into a `URI`-typed parameter, so
     `uri.fsPath` is `undefined` and **every local→remote path mapping (upload,
     download-target computation) crashes at runtime**. Verified by simulation; the
     released v1.16.3 never contained this code.
   - [test/preprocessor.js](test/preprocessor.js): Jest 28+ requires transformers to
     return `{ code }` instead of a bare string; wrap both returns
     (`return { code: tsc.transpile(...) }` / `return { code: src }`).
   - Validation evidence (2026-07-02, with the three fixes applied):
     `npx webpack --mode development` compiled with 0 errors (Node 20); `npm test` ran
     42 tests, 41 passing. The one failure — `sync --update with time offset` in
     `transfer-test.ts` — is a **pre-existing upstream bug** in the
     `remoteTimeOffsetInHours` round-trip (write/read offset asymmetry), invisible
     until the preprocessor fix lets the suite run. Only affects non-zero offset
     configs; default (0) unaffected. Fix separately / report upstream.

5. Rebrand lightly in `package.json` (`name`, `publisher`, `displayName`) **without**
   restructuring `src/`, so upstream diffs stay clean. Preserve LICENSE + attribution
   (MIT, liximomo → Natizyskunk).

6. Branch strategy: one feature branch per feature (`feat/download-path`,
   `feat/folder-compare`) **off `develop`** — not `master`, which is 28 commits behind
   with zero unique commits (`upstream/HEAD` → `develop`; CONTRIBUTING.md still says
   "target master" but is stale). PRs target `develop`.

---

## Feature 1 — Configurable per-profile download location

**Goal:** explicit download commands write to a configured local folder (default =
existing `context` behavior), preserving the remote-relative subpath. Per-profile
because profile fields override base.

**Changes:**

1. **Config schema** — add field (proposed name `downloadPath`) to `configScheme` in
   [src/modules/config.ts](src/modules/config.ts) **and** to
   [schema/definitions.json](schema/definitions.json) (wired into
   `schema/config.schema.json`, which `contributes.jsonValidation` binds to
   `.vscode/sftp.json` — without this users get editor warnings). No default (falls
   back to `context`). Per-profile override is automatic via `mergeProfile`.

2. **Redirect the download destination — opt-in, not unconditional.** `downloadHandle`
   is shared with `downloadOnOpen` and "Edit in Local", which must keep writing to the
   context-mapped path (Edit in Local opens `target.localUri` immediately after
   downloading). `createFileHandler` merges a per-call option object into the handler's
   options, so:
   - In [src/fileHandlers/transfer/index.ts](src/fileHandlers/transfer/index.ts), teach
     the `REMOTE_TO_LOCAL` branch of `createTransferHandle` to honor an option flag
     (e.g. `useDownloadPath: true`) plus the resolved config:
     - `rel = upath.relative(this.config.remotePath, this.target.remoteFsPath)`
     - base = `downloadPath` if absolute, else `path.join(this.fileService.baseDir, downloadPath)`
       (join, not resolve — mirror the Windows-root caveat in `serviceManager.getBasePath`)
     - `targetFsPath = flag && downloadPath ? path.join(base, rel) : localFsPath`
   - Pass `{ useDownloadPath: true }` from the explicit download commands only:
     `fileCommandDownload`, `fileCommandDownloadFile`, `fileCommandDownloadFolder`,
     `fileCommandDownloadProject`, `fileCommandDownloadActiveFile`,
     `fileCommandDownloadActiveFolder`, `fileCommandDownloadForce`.
   - **Untouched by design:** upload, sync (`sync2Local` calls `sync()` directly, not
     `downloadHandle`), diff, `downloadOnOpen`, Edit in Local.

3. **Docs** — add `downloadPath` to README config reference with a per-profile example.

**Edge cases:** destination dirs for folder downloads are created by `transfer()`'s
`ensureDir`; verify the single-file path creates parent dirs too (fs-extra `ensureDir`
is available if not). Relative `downloadPath` resolves against the resolved context
(`fileService.baseDir`); absolute paths honored as-is.

---

## Feature 2 — Folder Compare & diffs (dedicated tree)

**Goal:** pick a folder (from local explorer or Remote Explorer), compare against its
remote/local counterpart, show a categorized tree, click to diff/act.

**New module `src/modules/compareExplorer/`** (mirror `remoteExplorer/` structure):

- `treeDataProvider.ts` — `TreeDataProvider` with top-level groups **New Remote**,
  **New Local**, **Modified**; children are file entries carrying both URIs + status.

- `explorer.ts` — registers the view, holds current comparison root + results, `refresh()`.
- `index.ts` — barrel export; wire into activation like `remoteExplorer` is in `src/extension.ts`.

**New comparison service** (`src/fileHandlers/compare.ts`, built with
`createFileHandler` like `diff.ts`, so it gets `this.target`/`this.config`/`this.fileService`):

- Recursively list both sides via `this.fileService.getLocalFileSystem()` and
  `await this.fileService.getRemoteFileSystem(this.config)` (`list`/`lstat`).

- Honor ignore rules by reusing the **resolved** `this.config.ignore` — after
  `_createIgnoreFn` it's already a `(fsPath) => boolean` that handles both local and
  remote paths (no need to instantiate `src/core/ignore.ts` directly).

- Categorize each relative path:
  - only local → **New Local**; only remote → **New Remote**;
  - both exist → **Modified** using the same basis as sync's `isFileModified`
    ([transfer.ts:60-63](src/fileHandlers/transfer/transfer.ts#L60-L63)): mtime differs
    at second granularity OR size differs. Remote mtimes arrive already
    offset-adjusted from the FS layer — do not re-apply `remoteTimeOffsetInHours`.
    ⚠️ Known upstream bug: the offset round-trip is asymmetric (see Phase 0.4's failing
    test), so non-zero-offset configs may over-report Modified until fixed upstream.
    Optional content check for equal-size files: config-gated, off by default.

- Return grouped results for the tree provider.

**Commands** (new `fileCommand*.ts` files directly in `src/commands/` so the
auto-loader picks them up; add ids to `package.json` `contributes.commands` + `menus`):

- `sftp.compareFolder` / `sftp.compareActiveFolder` — run comparison, populate the tree.
  Context-menu on local folders and Remote Explorer folders.

- `sftp.compare.refresh` — re-run current comparison.
- Item click / inline actions — build a ctx with `handleCtxFromUri(localUri)` (exported
  from `src/fileHandlers`) and dispatch to the existing handlers:
  **Modified** → `diff` handler; **New Remote** → `downloadFile` (pass
  `{ useDownloadPath: true }` to respect Feature 1); **New Local** → `uploadFile`.

**package.json contributions:**

- New view `sftpCompare` in the existing `sftp` activity-bar container, gated by
  `when: sftp.enabled` like `remoteExplorer`.

- Command palette + explorer/remoteExplorer context-menu entries and item inline actions
  (download/upload/diff) via `contributes.menus` `view/item/context`.

---

## Phase 3 (deferred) — Settings GUI

Out of scope for this pass (user chose "GUI later"). When revisited: a webview panel
command (`sftp.openSettings`) that reads/writes `.vscode/sftp.json`, using
`@vscode/webview-ui-toolkit` for native-looking controls. Note here so it isn't forgotten.

---

## Files to create / modify (summary)

- Modify: `package.json` (branding, new commands, new view, menus),
  [src/modules/config.ts](src/modules/config.ts) (Joi schema),
  [schema/definitions.json](schema/definitions.json) + `schema/config.schema.json`
  (editor IntelliSense for `downloadPath`),
  [src/fileHandlers/transfer/index.ts](src/fileHandlers/transfer/index.ts) (opt-in
  download redirect), the seven `fileCommandDownload*.ts` commands (pass the flag),
  `src/extension.ts` (register compare explorer), README.

- Create: `src/modules/compareExplorer/{treeDataProvider,explorer,index}.ts`,
  `src/fileHandlers/compare.ts`, `src/commands/fileCommandCompareFolder.ts`
  (+ active-folder / refresh variants).

- Phase 0 baseline repairs (not yet applied — first execution step, on `fix/build-baseline`):
  `src/commands/abstract/createCommand.ts`, `src/helper/paths.ts`, `test/preprocessor.js`
  (exact changes specified in §Phase 0.4).

## Verification

0. **Baseline:** apply the §Phase 0.4 repairs, then expect webpack dev build 0 errors
   and `npm test` 41/42 (known pre-existing offset failure) — the numbers verified on
   2026-07-02 before the repairs were reverted. `git status` stays clean (autocrlf).

1. **Build:** `npm run dev` (webpack watch) — no TS/webpack errors.
2. **Launch:** F5 → Extension Development Host. Open a workspace with `.vscode/sftp.json`
   pointing at a real/test SFTP server.

3. **Download path:** set `downloadPath` (base and in a profile); Download File/Folder/Project;
   confirm files land in the configured folder with correct subpaths; switch profile
   (`SFTP: Set Profile`) and confirm the per-profile override wins. Confirm upload/sync
   unaffected — **and specifically that `downloadOnOpen` and "Edit in Local" still write
   to the context-mapped location.**

4. **Folder compare:** create known drift (a local-only file, a remote-only file, a
   modified file); run `SFTP: Compare Folder`; verify the three groups populate correctly;
   click Modified → diff opens; New Remote → download works (lands in `downloadPath` when
   set); New Local → upload works; Refresh updates after a change.

5. **Regression:** `npm test` stays at 41/42 or better; smoke-test existing
   upload/download/diff/sync.

6. **Upstream hygiene:** `git diff upstream/develop` stays additive/modular; each feature
   branch is PR-able; no CRLF committed.

## Open considerations

- Final config field name: `downloadPath` vs `localDownloadPath` (plan uses `downloadPath`).
- Whether `Download (Force)` should honor the redirect (plan says yes — same user intent).
- For "Modified" detection on large folders, content hashing is optional/config-gated;
  default to size+mtime like sync to keep it fast.

- Upstream PRs to file from the baseline repairs: createCommand import fix, paths.ts
  revert (or a properly typed re-do of the casing fix), Jest preprocessor fix, and the
  `remoteTimeOffsetInHours` round-trip bug.

# Plan: Fork Natizyskunk/vscode-sftp + Folder Compare, Parallel Transfers, Password Security & Configurable Locations

> **Validated against the codebase 2026-07-02. EXECUTED 2026-07-02.** Implemented as
> planned on local branches: `fix/build-baseline` (baseline repairs, one commit each,
> PR-able), `feat/download-path` (download-location feature + 6 unit tests), `feat/folder-compare`
> (folder-compare feature). Pushed to the fork `origin` (github.com.heu.io:aashay-147/vscode-sftp).
>
> **UPDATE 2026-07-05 — local testing findings + downloadPath DEFERRED.**
> Local F5/VSIX testing surfaced (1) an upstream SSH crash and (2) that `downloadPath`
> is only a half-mirror (downloads redirect, but compare + uploads still use the
> workspace↔remotePath map). Actions taken:
> - Added a 4th baseline repair `eda66f4` (SSH close/end listener — wraps
>   `this.end()` in arrow fns; upstream `develop` is unshippable without it).
> - **Reverted the download-path feature out of `integration`.** `integration` was
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
>
> **UPDATE 2026-07-06 — feature reorder + 4 new features added (planning only, not
> yet implemented/researched-to-validated-status like the two above).** Folder Compare
> is promoted to Feature 1 (it shipped first and is further along); download location
> moves to Feature 6. Four new features inserted in between, each grounded in a
> codebase research pass done today (file:line citations below, not yet build-verified):
> Feature 2 (parallel transfers/checks), Feature 3 (progress indication for compare &
> sync), Feature 4 (password security), Feature 5 (custom SFTP config file location).
>
> **UPDATE 2026-07-07 — 2 more new features inserted (planning only).** Two more
> features slotted in between Feature 2 and the (now-former) Feature 3, each grounded
> in a codebase research pass done today: new Feature 3 (upload/download overwrite
> confirmation) and new Feature 4 (upload/download diff-only transfer). Everything
> from the old Feature 3 onward shifts down by two.
>
> **UPDATE 2026-07-07 (cont'd) — Feature 9 added (speculative, planning only).**
> "Folder Compare view show subfolders" appended at the end — a nested-tree rework of
> the existing flat compare list, grounded against the actual shipped
> `src/modules/compareExplorer/treeDataProvider.ts` and `src/fileHandlers/compare.ts`
> (Feature 1 is already implemented and merged into `integration`, unlike Features
> 2-8 which are plan-only). Flagged speculative per the user's own "may be useful?" —
> validate demand before committing engineering time. Final order: 1 Folder Compare,
> 2 Multi-threaded transfers & checks, 3 Overwrite confirmation, 4 Diff-only
> upload/download, 5 Progress indication for compare & sync, 6 Password security,
> 7 Custom config location, 8 Download location, 9 Folder Compare nested subfolders
> (speculative).

## Context

We want our own SFTP extension for VS Code with new capabilities on top of an
existing, actively-maintained base:

1. **Folder Compare & diffs** — a way to compare a local folder against its remote
   counterpart and see, per file: *New Remote*, *New Local*, or *Modified* (differs
   on both sides), with click-to-diff.

2. **Multi-threaded / parallel upload, download & checks** — raise real transfer and
   comparison throughput instead of serializing everything through one connection.

3. **Upload/Download overwrite confirmation** — a per-profile-overrideable prompt
   before an explicit upload/download overwrites an existing destination file,
   instead of today's silent one-click overwrite.

4. **Upload/Download diff-only transfer** — skip files that are already identical on
   the destination during explicit upload/download, the way `Sync` already does,
   purely to cut needless transfer time.

5. **Progress indication for compare & sync** — replace the blunt global spinner with
   real per-operation progress feedback for these two multi-file operations.

6. **Password security in config** — stop storing SFTP passwords in plaintext inside
   `.vscode/sftp.json`.

7. **Custom location for the SFTP config file** — let users point the extension at a
   `sftp.json` outside the default `.vscode/` folder.

8. **Configurable download location** — let the user decide, in config, where
   downloads land locally, independent of the working `context` folder — settable
   **per profile**.

9. **Folder Compare view: show subfolders** *(speculative — "may be useful?")* — nest
   the compare tree by folder instead of listing every file flat under each status
   group.

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

- **Connection model** (relevant to Feature 2): one shared, keep-alive connection per
  profile — `createRemoteIfNoneExist()` ([src/core/remoteFs.ts:120-134](src/core/remoteFs.ts#L120-L134))
  hashes the connect options and caches a singleton `KeepAliveRemoteFs`
  ([remoteFs.ts:20-110](src/core/remoteFs.ts#L20-L110)) wrapping one `SFTPFileSystem`/`FTPFileSystem`.
  For SFTP, `SSHClient._doConnect` ([src/core/remote-client/sshClient.ts:35-102](src/core/remote-client/sshClient.ts#L35-L102))
  opens exactly one `ssh2.Client`, then one `client.sftp()` subsystem channel
  ([sshClient.ts:324-334](src/core/remote-client/sshClient.ts#L324-L334)). All concurrent
  `TransferTask`s run over that **one** SFTP channel. Transfers use a hand-rolled `Scheduler`
  ([src/core/scheduler.ts:78-196](src/core/scheduler.ts#L78-L196), ported from an old
  `p-queue`; `p-queue@2.4.2` is also a direct dependency but appears unused for transfers —
  worth checking before adding a new queue lib) created per-call via
  `fileService.createTransferScheduler(this.config.concurrency)`; default `concurrency: 4`
  ([config.ts:54,87](src/modules/config.ts#L54)), forced to `1` for FTP
  ([fileService.ts:572-574](src/core/fileService.ts#L572-L574), mirroring the `ftp` lib's own
  `PQueue({ concurrency: 1 })` in [ftpFileSystem.ts:52](src/core/fs/ftpFileSystem.ts#L52)).
  Concurrency today only **pipelines** multiple in-flight requests on the same
  channel/connection — it does not open extra sockets — and is bounded further by
  `MAX_OPEN_FD_NUM = 222` open handles ([sshClient.ts:9,174-234](src/core/remote-client/sshClient.ts#L9)).

- **Password storage** (relevant to Feature 6): plaintext Joi string field
  (`password: nullable(Joi.string())`, [config.ts:21](src/modules/config.ts#L21);
  `schema/definitions.json:161-163`), read straight from `.vscode/sftp.json` via
  `fse.readJson` in `readConfigsFromFile` ([config.ts:141-144](src/modules/config.ts#L141-L144))
  with no decryption step, flowing unchanged into `client.connect()`
  ([sshClient.ts:299-320](src/core/remote-client/sshClient.ts#L299-L320)). No
  `vscode.ExtensionContext.secrets`/`SecretStorage` usage exists anywhere in the codebase
  today (confirmed by repo-wide grep). The only fallback is `promptForPassword()`
  ([src/host.ts:62](src/host.ts#L62), used from `remoteFs.ts:83` and `sshClient.ts:249-296`)
  for when no password is stored at all — not a secret-store lookup.

- **Config file location** (relevant to Feature 7): hardcoded —
  `CONGIF_FILENAME = 'sftp.json'` and `CONFIG_PATH = path.join('.vscode', 'sftp.json')`
  ([src/constants.ts:3,10-11](src/constants.ts#L3)). `getConfigPath(basePath)`
  ([config.ts:124-126](src/modules/config.ts#L124-L126)) just joins workspace root +
  `CONFIG_PATH`, no override hook; `tryLoadConfigs(dir)` ([config.ts:148-158](src/modules/config.ts#L148-L158))
  and `newConfig()` ([config.ts:170-199](src/modules/config.ts#L170-L199), the `sftp.config`
  command) use the same hardcoded path. Activation is gated on
  `activationEvents: ["onCommand:sftp.config", "workspaceContains:.vscode/sftp.json"]`
  in `package.json`. Existing precedent for reading a plain VS Code setting:
  `getUserSetting(section, workspaceUri)` ([src/host.ts:8](src/host.ts#L8)), already used
  e.g. via `SETTING_KEY_REMOTE` in [fileService.ts:9,191](src/core/fileService.ts#L9); and
  `contributes.configuration` entries already exist in `package.json:66-83`
  (`sftp.printDebugLog`, `sftp.debug`, `sftp.downloadWhenOpenInRemoteExplorer`).

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

6. Branch strategy: one feature branch per feature (`feat/folder-compare`,
   `feat/parallel-transfers`, `feat/password-security`, `feat/config-path`,
   `feat/download-path`) **off `develop`** — not `master`, which is 28 commits behind
   with zero unique commits (`upstream/HEAD` → `develop`; CONTRIBUTING.md still says
   "target master" but is stale). PRs target `develop`.

---

## Feature 1 — Folder Compare & diffs (dedicated tree)

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

- ⚠️ **Current implementation gap (feeds Feature 2):** `collectFiles`
  ([src/fileHandlers/compare.ts:50-71](src/fileHandlers/compare.ts#L50-L71)) walks
  directories with **unbounded** `Promise.all` fan-out per level — no concurrency cap,
  no reuse of the transfer scheduler. Feature 2 routes this through the same scheduler
  used for transfers.

**Commands** (new `fileCommand*.ts` files directly in `src/commands/` so the
auto-loader picks them up; add ids to `package.json` `contributes.commands` + `menus`):

- `sftp.compareFolder` / `sftp.compareActiveFolder` — run comparison, populate the tree.
  Context-menu on local folders and Remote Explorer folders.

- `sftp.compare.refresh` — re-run current comparison.
- Item click / inline actions — build a ctx with `handleCtxFromUri(localUri)` (exported
  from `src/fileHandlers`) and dispatch to the existing handlers:
  **Modified** → `diff` handler; **New Remote** → `downloadFile` (pass
  `{ useDownloadPath: true }` to respect Feature 6); **New Local** → `uploadFile`.

**package.json contributions:**

- New view `sftpCompare` in the existing `sftp` activity-bar container, gated by
  `when: sftp.enabled` like `remoteExplorer`.

- Command palette + explorer/remoteExplorer context-menu entries and item inline actions
  (download/upload/diff) via `contributes.menus` `view/item/context`.

---

## Feature 2 — Multi-threaded / parallel upload, download & checks

**Goal:** raise real transfer and comparison throughput — both by exposing the
existing per-call concurrency knob as a documented, tunable "thread count" and, for
the actual bottleneck, pooling multiple SFTP connections/channels per profile instead
of pipelining everything through one channel; also bring folder-compare's directory
walk (Feature 1) under the same concurrency control.

**Current state (see Base architecture):** `concurrency` already exists
(`config.ts:54,87`, default 4, forced to 1 for FTP) and is used per-call via
`fileService.createTransferScheduler(this.config.concurrency)`
([transfer/index.ts:10,49,92](src/fileHandlers/transfer/index.ts#L10)) to bound a
hand-rolled `Scheduler` ([scheduler.ts:78-196](src/core/scheduler.ts#L78-L196)). But
every concurrent `TransferTask` still shares the **one** SFTP channel opened by
`SSHClient._doConnect` ([sshClient.ts:35-102,324-334](src/core/remote-client/sshClient.ts#L35-L102)) —
so raising `concurrency` today only pipelines more in-flight requests on one channel,
it doesn't add real parallel I/O paths, and folder-compare doesn't use the scheduler
at all.

**Changes:**

1. **Expose/rename the concurrency field as a first-class "thread count".** Reuse
   `concurrency` (already Joi-typed, already per-profile-overridable via
   `mergeProfile`) rather than adding a parallel field; document it explicitly in
   README + [schema/definitions.json](schema/definitions.json) as "max parallel
   transfer operations". Leave the FTP override at `fileService.ts:572-574` (forced
   to 1) untouched — the `ftp` lib is single-connection by design
   ([ftpFileSystem.ts:52](src/core/fs/ftpFileSystem.ts#L52)).

2. **Connection pooling (the real bottleneck).** Extend `createRemoteIfNoneExist()`
   ([remoteFs.ts:120-134](src/core/remoteFs.ts#L120-L134)), which today caches a single
   `KeepAliveRemoteFs` per hashed connect-options key, into a small pool of up to N
   `SSHClient`/`sftp()` pairs per profile (N = configured `concurrency`, capped at a
   sane max e.g. 8). Grow the pool **lazily** (start at 1 connection, open more only
   under sustained load) rather than eagerly opening N connections on first use, to
   avoid multiplying auth handshakes for small transfers. Round-robin/least-busy
   assignment from `Scheduler` so concurrent `TransferTask`s
   ([sftpFileSystem.ts](src/core/fs/sftpFileSystem.ts)) run over separate
   channels/sockets. Still respect `MAX_OPEN_FD_NUM = 222`
   ([sshClient.ts:9,174-234](src/core/remote-client/sshClient.ts#L9)) **per channel** —
   pooling reduces pressure on any single channel's handle budget rather than raising
   the ceiling. Pool members must be torn down together on disconnect (extend the
   existing `KeepAliveRemoteFs` disposal path) to avoid leaking sockets.

3. **Parallelize compare "checks".** Route `compareFolders`'s `collectFiles`
   ([compare.ts:50-71](src/fileHandlers/compare.ts#L50-L71)) through
   `fileService.createTransferScheduler()` (or a new lightweight scheduler instance)
   instead of raw unbounded `Promise.all`, so folder-compare listing respects the same
   concurrency cap as transfers and benefits from the same connection pool.

4. **Docs** — document the thread-count field and its FTP exemption; note in the
   Feature 1 (folder compare) section that "checks" now share this cap.

**Edge cases:** lazy pool growth to avoid handshake storms on small transfers;
existing single-connection behavior must remain the default until a profile
explicitly raises `concurrency` above 1, so this stays additive/backward-compatible;
`p-queue@2.4.2` is already a dependency but unused for transfers today — confirm
whether to adopt it in place of the hand-rolled `Scheduler` or leave `Scheduler` as-is
to minimize diff surface.

---

## Feature 3 — Upload/Download overwrite confirmation

**Goal:** an explicit upload/download that would overwrite an existing destination
file prompts for confirmation instead of silently overwriting — configurable per
profile (default preserves today's one-click behavior for back-compat, since this
extension's whole workflow assumes fast, frictionless transfers).

**Current state:** no confirmation exists anywhere in the transfer or delete paths.
`transferFile()` ([transfer.ts:116-142](src/fileHandlers/transfer/transfer.ts#L116-L142))
unconditionally collects a `TransferTask` for the scheduler to execute as a `put`/`get`
— no existence check, no diff check, no prompt. `transferWithType()`
([transfer.ts:144-184](src/fileHandlers/transfer/transfer.ts#L144-L184)), the only gate
before it, only conditionally saves a dirty document before upload
(`transfer.ts:166-178`) — nothing about the destination. `createTransferHandle()`
([index.ts:5-38](src/fileHandlers/transfer/index.ts#L5-L38)), backing `upload`,
`uploadFile`, `uploadFolder`, `download`, `downloadFile`, `downloadFolder`
(`index.ts:121-212`), calls `transfer()` directly with no confirmation hook. Even
delete (`removeRemote`, [remove.ts:7-40](src/fileHandlers/remove.ts#L7-L40)) has no
confirmation prompt today — there is no existing "destructive op confirms" precedent
in this codebase to mirror.

**Existing precedent to reuse:** `showConfirmMessage()`
([host.ts:86-98](src/host.ts#L86-L98)), a generic Yes/No wrapper around
`vscode.window.showInformationMessage`, already used for the closest analogous
per-profile idiom — `downloadOnOpen: boolean | 'confirm'`
([fileActivityMonitor.ts:69-72](src/modules/fileActivityMonitor.ts#L69-L72)). That
`boolean | 'confirm'` shape (rather than a plain boolean) is the better template here:
`'confirm'` prompts, `true`/`false` force always/never.

**Changes:**

1. **Config schema** — add `confirmOverwrite: boolean | 'confirm'` (default `false`,
   preserving current behavior) following the `uploadOnSave`/`downloadOnOpen` pattern:
   declare in `configScheme`/`defaultConfig` ([config.ts:40,76](src/modules/config.ts#L40)),
   register as a recognized `FileService` config key
   ([fileService.ts:39,151](src/core/fileService.ts#L39)), and add to
   [schema/definitions.json](schema/definitions.json) (mirroring the existing
   `downloadOnOpen` entry). Per-profile override is automatic via `mergeProfile`.

2. **Gate the overwrite.** In `transferFile`/`transferWithType`
   (`transfer.ts:116-184`), before calling into the actual `put`/`get`, check whether
   the destination already exists (`targetFs.lstat(targetFsPath)`, swallowing the
   not-found case) and — if `confirmOverwrite` is `'confirm'` (or `true`) — call
   `showConfirmMessage()` (imported from `host.ts`) before proceeding; skip the
   transfer if the user declines. Thread the resolved config value through
   `TransferOption`/`transformOption()` the same way `dirPerm`/`filePerm` are threaded
   today (`index.ts:29-30`, `transfer.ts:434-435`).

3. **Scope.** Applies to explicit `Upload`/`Download` (file, folder, project,
   active-file/folder) — **not** `Sync`, which has its own explicit-intent semantics
   and already has a smaller blast radius via `isFileModified` (see Feature 4); not
   `downloadOnOpen`/"Edit in Local", which already has its own confirm idiom.

4. **Docs** — README note on `confirmOverwrite` with a per-profile example.

**Edge cases:** folder transfers with many files — prompting per-file would be
unusable; for folder-level commands, either batch into a single upfront "N files will
be overwritten, continue?" prompt (simplest) or restrict live per-file confirmation to
single-file commands and treat folder commands as all-or-nothing. Confirm the
lstat-exists check doesn't itself introduce a full extra round-trip per file on slow
SFTP links for users who leave the default (`false`) — the check should be skipped
entirely when `confirmOverwrite` is falsy.

---

## Feature 4 — Upload/Download diff-only transfer

**Goal:** explicit upload/download of a folder skips files that are already identical
on the destination — the same size+mtime check `Sync` already applies — purely as a
performance optimization (no prompt, no behavior change beyond fewer redundant
transfers).

**Current state:** `isFileModified()` is defined **twice**, independently, and used
by neither plain upload nor plain download:
- [transfer.ts:60-63](src/fileHandlers/transfer/transfer.ts#L60-L63) — used only inside
  `_sync`'s `syncFiles` closure (`transfer.ts:272`) to decide whether to include a file
  in `sync2Remote`/`sync2Local` (`index.ts:43-119`).
- [compare.ts:31-33](src/fileHandlers/compare.ts#L31-L33) — an independent duplicate,
  used only by `compareFolders` (`compare.ts:102`) for the read-only Feature 1 diff
  view.

Plain `transferFolder()` ([transfer.ts:73-114](src/fileHandlers/transfer/transfer.ts#L73-L114)),
which backs `uploadFolder`/`downloadFolder` (and transitively `uploadFile`/
`downloadFile`, `Upload/Download Project`, active-file/folder variants) via
`createTransferHandle` (`index.ts:5-38`), calls `transferWithType` for every file
entry unconditionally (`transfer.ts:92-111`) — confirmed by grep, `isFileModified` is
never referenced from `transferFolder`/`transferFile`/`transferWithType`. So a folder
re-download today re-transfers every file even if nothing changed, unlike `Sync`.

**Changes:**

1. **Config/option** — add a `skipUnmodified` transfer-option flag (per-profile config
   field, e.g. `downloadUploadDiffOnly` or reuse a naming consistent with Feature 3),
   threaded through `TransferOption`/`transformOption()` in
   [index.ts](src/fileHandlers/transfer/index.ts) the same way other per-call options
   are passed today (mirrors Feature 5/6's `useDownloadPath` flag pattern).

2. **Reuse the existing check.** In `transferFolder()`'s file-entry loop
   (`transfer.ts:92-111`), when the flag is set, `lstat`/`list` the corresponding
   target path and call the existing `isFileModified()`
   (`transfer.ts:60-63`) before invoking `transferWithType` for `FileType.File`/
   `SymbolicLink` entries — exactly what `_sync`'s `syncFiles` already does at
   `transfer.ts:272`. No new modified-check logic; this only wires the existing check
   into a second call path.

3. **Default/UX.** Off by default (explicit Upload/Download historically means "force
   this exact state," so silently skipping files is a behavior change some users won't
   expect) — expose as an opt-in per-profile flag and/or a one-off command variant
   (e.g. reuse `Download (Force)`'s naming convention in reverse: a "smart"
   Download/Upload that's diff-aware, alongside the existing always-transfer commands).

4. **Docs** — README note explaining the flag skips already-identical files using the
   same size+mtime basis as `Sync` and Folder Compare, with the same
   `remoteTimeOffsetInHours` caveat noted in Feature 1.

**Edge cases:** same `remoteTimeOffsetInHours` round-trip bug noted in Feature 1/Phase
0.4 applies here too — non-zero-offset profiles may over- or under-skip; single-file
`Upload`/`Download File` commands have no real "diff" concept for a lone target
(the whole point is transferring that one file) — scope this feature to folder-level
commands (`uploadFolder`/`downloadFolder`/`Download Project`) where skip-if-identical
actually saves work across many files.

---

## Feature 5 — Progress indication for compare & sync

**Goal:** replace the coarse global spinner (shared indiscriminately by every file
handler) with real per-operation progress feedback for the two longest-running,
multi-file operations users interact with most — sync and folder compare — using VS
Code's native progress UI.

**Current state:** `vscode.window.withProgress`/`ProgressLocation` is used **nowhere**
in `src/` (confirmed by repo-wide grep). The only existing feedback:

- A single global spin animation + transient text, `StatusBarItem`
  ([src/ui/statusBarItem.ts:16-131](src/ui/statusBarItem.ts#L16-L131),
  `startSpinner`/`stopSpinner`/`showMsg`), instantiated once as `app.sftpBarItem`
  ([src/app.ts:19](src/app.ts#L19)).
- `createFileHandler.ts:106,118` wraps **every** handler (upload/download/sync/
  compare/remove/rename/create) with start/stop-spinner calls — identical treatment
  regardless of operation size, no count or percentage.
- Per-file status text *does* exist, but only for scheduler-driven transfers:
  `serviceManager/index.ts:102-124` shows `"upload foo.js"` / `"done foo.js"` via
  `service.beforeTransfer`/`afterTransfer`, wired to `FileService.createTransferScheduler`
  events ([fileService.ts:110-116,454-467](src/core/fileService.ts#L110-L116), backed by
  `core/scheduler.ts:147-165`'s `onTaskStart`/`onTaskDone`). Already used by the sync
  path via `transfer/index.ts:10,36,49,64,92,104`.
- Folder compare's own walk ([compare.ts:35-72,74-129](src/fileHandlers/compare.ts#L35-L72))
  bypasses the scheduler entirely (see Feature 1/2 notes on `collectFiles`'s raw
  `Promise.all`) — it gets **zero** per-item feedback today, only the blunt spinner.

**Changes:**

1. **Sync** — wrap the `sync2Remote`/`sync2Local` scheduler run
   ([transfer/index.ts](src/fileHandlers/transfer/index.ts)) in
   `vscode.window.withProgress({ location: ProgressLocation.Notification, cancellable: true })`;
   subscribe to `beforeTransfer`/`afterTransfer`
   ([fileService.ts:446-452](src/core/fileService.ts#L446-L452)) scoped to that call to
   report `increment`/`message` per file, with total = `scheduler.size`
   ([fileService.ts:110-116](src/core/fileService.ts#L110-L116)) captured right after
   the collect phase and before `run()`. Wire `token.onCancellationRequested` to the
   existing `scheduler.stop()` ([fileService.ts:475-478](src/core/fileService.ts#L475-L478)).

2. **Compare** — instrument `collectFiles` ([compare.ts:35-72](src/fileHandlers/compare.ts#L35-L72))
   with a counter callback so the walk reports file counts as it proceeds, wrapped in
   `withProgress` in **indeterminate** mode (total isn't known upfront — folder sizes
   aren't pre-counted). Once Feature 2 routes compare through
   `createTransferScheduler`, the same `beforeTransfer`/`afterTransfer` hooks used for
   sync become available here for free, upgrading this to a determinate progress bar.

3. **Optional centralization** — add a `withProgress`-wrapping option to
   `createFileHandler` ([createFileHandler.ts:86-126](src/fileHandlers/createFileHandler.ts#L86-L126))
   so compare/sync opt in without duplicating boilerplate, augmenting (not replacing)
   the blunt `startSpinner`/`stopSpinner` calls (lines 106, 118) for these two handlers
   specifically. Other handlers (single-file upload/download, diff, rename) keep the
   existing spinner-only behavior — this feature is scoped to the two multi-file
   operations users asked about.

4. **Docs** — note in the README's Sync and Folder Compare sections that progress now
   surfaces as a VS Code notification, and (for compare) that it starts indeterminate
   until Feature 2 lands.

**Edge cases:** cancellation mid-sync must not leave state worse than today — confirm
`scheduler.stop()` is a clean stop between files, not a mid-file abort; compare's
indeterminate progress (no known total without a separate counting pass) is an
accepted limitation — an upfront count would double directory-listing work, so it's
deferred unless Feature 2's scheduler integration makes it cheap.

---

## Feature 6 — Password security in config

**Goal:** stop storing SFTP passwords in plaintext inside `.vscode/sftp.json`
(currently committed to disk, visible in the workspace and in any VCS history that
includes the file); move to VS Code's `SecretStorage` API, keeping the existing
plaintext field as an opt-in/back-compat path.

**Current state (see Base architecture):** `password` is a plain Joi string
(`config.ts:21`; `schema/definitions.json:161-163`), read straight from JSON
(`config.ts:141-144`) and passed unchanged to `client.connect()`
(`sshClient.ts:299-320`). No `SecretStorage` usage exists anywhere in the codebase.
The only existing fallback, `promptForPassword()` (`host.ts:62`), prompts fresh every
time when no password is stored — it isn't a secret-store lookup.

**Changes:**

1. **Schema** — keep `password` string field as-is for back-compat; a profile that
   omits it becomes the trigger for secret-store resolution instead of falling straight
   through to `promptForPassword()`.

2. **Plumbing.** `src/modules/config.ts` today only imports `vscode`/`fse`/`Joi` — no
   `ExtensionContext` flows into it. Thread `context.secrets`
   (`vscode.ExtensionContext.secrets`, VS Code's `SecretStorage`) from `extension.ts`
   activation into `config.ts`'s `readConfigsFromFile`/`newConfig`
   (`config.ts:141-144, 170-199`) so secret lookups/writes are available where config
   is read/created. When a profile has no `password` field, resolve it via
   `context.secrets.get(secretKeyFor(workspaceFolder, profile))` before falling back to
   `promptForPassword()`.

3. **Write path.** New/updated flow off the `sftp.config` command
   (`config.ts:170`) / a new "SFTP: Set Password" command prompts for a password and
   stores it via `context.secrets.store(secretKeyFor(...), password)`, leaving the
   JSON field absent (or set to a marker) rather than writing the raw value to disk.

4. **Migration.** On load, if a profile has a plaintext `password` **and** no secret
   is yet stored for it, offer (via a one-time notification) to migrate it into
   `SecretStorage` and strip it from the JSON file (write-back), so existing users
   aren't silently broken and aren't force-migrated without consent.

5. **Docs** — README section on where passwords now live, a callout that
   `.vscode/sftp.json` should no longer be committed with a password, and a note that
   this pairs naturally with Feature 7 (relocating the config file outside the repo
   entirely).

**Edge cases:** `SecretStorage` is per-extension and effectively per-machine (not
synced by default, and not portable across machines the way the JSON file is) — teams
sharing `sftp.json` via VCS will need each developer to enter their own password once;
document this explicitly. Multi-root workspaces: key secrets by workspace-folder +
profile name to avoid collisions between same-named profiles in different folders.

---

## Feature 7 — Custom location for the SFTP config file

**Goal:** let users point the extension at a `sftp.json` outside the default
`.vscode/` folder — e.g. a shared/synced location, or outside the repo entirely so it
is never committed (pairs with Feature 6).

**Current state (see Base architecture):** hardcoded —
`CONFIG_PATH = path.join('.vscode', 'sftp.json')` (`constants.ts:3,10-11`);
`getConfigPath(basePath)` (`config.ts:124-126`) just joins workspace root +
`CONFIG_PATH`, no override hook; `tryLoadConfigs`/`newConfig`
(`config.ts:148-158, 170-199`) use the same path. Activation is gated on
`workspaceContains:.vscode/sftp.json` in `package.json`.

**Changes:**

1. **New setting** `sftp.configPath` in `contributes.configuration`
   (`package.json:66-83`, alongside `sftp.printDebugLog` etc.) — string, default
   unset (falls back to today's behavior). Relative paths resolve against the
   workspace root; absolute paths honored as-is (mirror the `downloadPath` convention
   from Feature 8 for consistency).

2. **Resolution.** `getConfigPath(basePath)` (`config.ts:124-126`) and
   `tryLoadConfigs(dir)` (`config.ts:148-158`) read the setting via the existing
   `getUserSetting(section, workspaceUri)` helper (`host.ts:8`, precedent:
   `SETTING_KEY_REMOTE` in `fileService.ts:9,191`); if set, use it, else fall back to
   `CONFIG_PATH` (`constants.ts:10-11`).

3. **Command path.** Thread the resolved path into `newConfig()` (`config.ts:170`) so
   `SFTP: Config` creates/opens the relocated file, not always `.vscode/sftp.json`.

4. **Activation.** `activationEvents` currently only has
   `workspaceContains:.vscode/sftp.json`, which won't fire for a relocated file. Add a
   broader `workspaceContains:**/sftp.json` and/or an `onStartupFinished` fallback so
   the extension still activates when the setting points elsewhere.

5. **Docs** — README section on `sftp.configPath` with an example pointing outside the
   workspace, cross-referenced from Feature 6's migration note.

**Edge cases:** this is a plain workspace setting, not per-profile — it selects which
file the profiles live in, so profile-level override doesn't apply. Multi-root
workspaces need the setting evaluated per-folder (`getUserSetting` already accepts a
`workspaceUri`).

---

## Feature 8 — Configurable per-profile download location

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

## Feature 9 — Folder Compare view: show subfolders *(speculative)*

**Goal:** the Folder Compare tree ([Feature 1](#feature-1--folder-compare--diffs-dedicated-tree))
nests entries by their actual folder hierarchy under each status group, instead of a
flat file list with the subfolder shown only as cosmetic text. **Flagged
speculative** — the user framed this as "may be useful?" rather than a firm ask;
validate it's actually easier to scan before investing in it, since the current flat
+ description approach already surfaces the same information.

**Current state (Feature 1 is already implemented and merged into `integration` —
this is grounded against the real shipped code, not a plan):**
`CompareTreeDataProvider.getChildren()`
([treeDataProvider.ts:89-99](src/modules/compareExplorer/treeDataProvider.ts#L89-L99))
is exactly two levels deep: top-level status groups (`GROUPS`,
[treeDataProvider.ts:18-22](src/modules/compareExplorer/treeDataProvider.ts#L18-L22))
then a flat list of every `CompareEntry` under that status
(`_entriesOf`, [treeDataProvider.ts:101-106](src/modules/compareExplorer/treeDataProvider.ts#L101-L106)).
Subfolder context is preserved only as a label suffix: `getTreeItem` splits
`entry.relPath` on the last `/` and puts everything before it into
`treeItem.description` ([treeDataProvider.ts:72-74](src/modules/compareExplorer/treeDataProvider.ts#L72-L74))
— a file three directories deep shows as `foo.js` with description `src/deep/nested`,
not as an expandable folder chain. The full relative path is already there
(`CompareEntry.relPath`, [compare.ts:14-15](src/fileHandlers/compare.ts#L14-L15)), it's
just never re-nested; `collectFiles`'s recursive walk
([compare.ts:35-72](src/fileHandlers/compare.ts#L35-L72)) flattens results directly
into one `Map<string, FileEntry>` keyed by posix-relative path (line 62-65) as it
returns, and `compareFolders` sorts the final flat `entries` array by `relPath`
([compare.ts:119](src/fileHandlers/compare.ts#L119)) — folder identity is discarded
after collection, only leaf entries carry a full path.

**Changes (client-side tree transform only — no changes needed to `compare.ts`/
`collectFiles`, since `entries` already carries everything required):**

1. Extend the `CompareNode` union in `treeDataProvider.ts` with a third kind, e.g.
   `{ kind: 'folder', status: CompareStatus, relDir: string }`, alongside the existing
   `CompareGroup`/`CompareItem`.
2. In `getChildren`, when asked for the children of a group or folder node, group the
   already-flat, already-sorted `entries` for that status by their next path segment
   under the current `relDir` — a pure transform of data already on `CompareResult`,
   no new fetch/walk.
3. `getTreeItem` for folder nodes: label = last path segment,
   `TreeItemCollapsibleState.Collapsed`, `ThemeIcon('folder')`.
4. Leaf `getTreeItem` drops the `description` subfolder-suffix hack
   (`treeDataProvider.ts:72-74`) once real nesting exists — label becomes just the
   filename.
5. Consider a toggle (mirroring VS Code's own flat-vs-tree Explorer setting) so users
   who prefer the current flat view keep it, rather than forcing a UX change on a
   speculative feature — e.g. `sftp.compareExplorer.flatten` (default matching
   whichever mode ships first).

**Edge cases:** nesting is scoped **within each status group** — folders never merge
across *Modified*/*New Remote*/*New Local*, so a folder appearing under two groups is
two distinct tree nodes, not one; today's per-group file *count* in the group's
`description` ([treeDataProvider.ts:59](src/modules/compareExplorer/treeDataProvider.ts#L59))
should be preserved so nesting doesn't cost the at-a-glance "how many files changed"
signal.

---

## Phase 3 (deferred) — Settings GUI

Out of scope for this pass (user chose "GUI later"). When revisited: a webview panel
command (`sftp.openSettings`) that reads/writes `.vscode/sftp.json` (or the Feature 7
relocated path), using `@vscode/webview-ui-toolkit` for native-looking controls. Note
here so it isn't forgotten.

---

## Files to create / modify (summary)

- Modify: `package.json` (branding, new commands, new view, menus, `sftp.configPath`
  setting + activation events),
  [src/modules/config.ts](src/modules/config.ts) (Joi schema: `downloadPath`,
  `confirmOverwrite`, diff-only transfer flag;
  `ExtensionContext.secrets` plumbing; `getConfigPath`/`tryLoadConfigs` reading
  `sftp.configPath`),
  [src/core/fileService.ts](src/core/fileService.ts) (register `confirmOverwrite` as
  a recognized config key),
  [schema/definitions.json](schema/definitions.json) + `schema/config.schema.json`
  (editor IntelliSense for `downloadPath`, `confirmOverwrite`, diff-only flag;
  documented `concurrency`),
  [src/fileHandlers/transfer/transfer.ts](src/fileHandlers/transfer/transfer.ts)
  (overwrite-confirmation gate in `transferFile`/`transferWithType`; `isFileModified`
  reuse in `transferFolder`'s file loop for diff-only transfer),
  [src/fileHandlers/transfer/index.ts](src/fileHandlers/transfer/index.ts) (opt-in
  download redirect; `withProgress`-wrapped sync; thread `confirmOverwrite`/
  `skipUnmodified` through `TransferOption`), the seven
  `fileCommandDownload*.ts` commands (pass the flags),
  `src/host.ts` (SecretStorage-aware password resolution; reuse `showConfirmMessage`
  for overwrite confirmation),
  [src/core/remoteFs.ts](src/core/remoteFs.ts) + [src/core/remote-client/sshClient.ts](src/core/remote-client/sshClient.ts)
  (connection pooling), [src/fileHandlers/compare.ts](src/fileHandlers/compare.ts)
  (scheduler-routed walk; progress counter callback),
  [src/fileHandlers/createFileHandler.ts](src/fileHandlers/createFileHandler.ts)
  (optional `withProgress`-wrapping option),
  [src/modules/compareExplorer/treeDataProvider.ts](src/modules/compareExplorer/treeDataProvider.ts)
  (Feature 9 — nested folder nodes, `CompareNode` union, optional flatten setting),
  `src/extension.ts` (register compare explorer; thread `context.secrets` into config
  module), README.

- Create: a password-entry/migration command (Feature 6).

- **Already shipped, not to be re-created:** `src/modules/compareExplorer/
  {treeDataProvider,explorer,index}.ts`, `src/fileHandlers/compare.ts`,
  `src/commands/fileCommandCompareFolder*.ts` (Feature 1 — merged into `integration`;
  Feature 9 modifies `treeDataProvider.ts` in place, see above).

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

3. **Folder compare (Feature 1):** create known drift (a local-only file, a remote-only
   file, a modified file); run `SFTP: Compare Folder`; verify the three groups populate
   correctly; click Modified → diff opens; New Remote → download works (lands in
   `downloadPath` when set); New Local → upload works; Refresh updates after a change.

4. **Parallel transfers & checks (Feature 2):** with `concurrency` raised above 1 on a
   profile, transfer a folder with many small files and confirm multiple connections/
   channels are actually in flight (not just pipelined on one) and total transfer time
   drops vs. `concurrency: 1`; run folder compare on a large tree and confirm it
   respects the same cap (no unbounded fan-out) and produces identical results to the
   unthreaded run; confirm FTP profiles remain forced to `concurrency: 1`.

5. **Overwrite confirmation (Feature 3):** with `confirmOverwrite: 'confirm'` on a
   profile, Upload/Download a file that already exists at the destination and confirm
   a prompt appears, declining skips the transfer, accepting proceeds; confirm the
   default (`false`) reproduces today's silent-overwrite behavior exactly; confirm
   `Sync` and `downloadOnOpen`/"Edit in Local" are unaffected (out of scope for this
   flag).

6. **Diff-only transfer (Feature 4):** with the diff-only flag enabled, Download/Upload
   a folder where some files are already identical on the destination and confirm
   those files are skipped (no transfer, no overwrite prompt from Feature 3) while
   changed/missing files still transfer; confirm results match what `Sync` would do
   for the same tree; confirm the flag defaults off and unflagged behavior re-transfers
   everything as today.

7. **Progress indication (Feature 5):** run `SFTP: Sync` on a folder with several
   files and confirm a cancellable progress notification appears, incrementing
   per-file, and that cancelling mid-sync stops cleanly (no partial-file corruption);
   run `SFTP: Compare Folder` on a large tree and confirm a progress notification
   appears (indeterminate, or determinate if Feature 2 already landed) instead of only
   the blunt status-bar spinner; confirm other single-file operations (upload,
   download, diff) are unaffected and keep the existing spinner-only behavior.

8. **Password security (Feature 6):** set a profile password via the new command,
   confirm it's stored in `SecretStorage` and absent (or masked) from `sftp.json` on
   disk; confirm connect still succeeds; confirm the plaintext-password migration
   prompt appears for a profile with an existing plaintext password and correctly
   strips it after migration; confirm a second machine/profile without the secret
   falls back to `promptForPassword()`.

9. **Custom config location (Feature 7):** set `sftp.configPath` to a path outside
   `.vscode/`, confirm `SFTP: Config` creates/opens it there, confirm the extension
   activates and loads profiles from the relocated file on workspace open, confirm
   unset behavior is unchanged (`.vscode/sftp.json`).

10. **Download path (Feature 8):** set `downloadPath` (base and in a profile); Download
   File/Folder/Project; confirm files land in the configured folder with correct
   subpaths; switch profile (`SFTP: Set Profile`) and confirm the per-profile override
   wins. Confirm upload/sync unaffected — **and specifically that `downloadOnOpen` and
   "Edit in Local" still write to the context-mapped location.**

11. **Folder Compare nested subfolders (Feature 9, speculative):** with drift several
   directories deep on both sides, confirm each status group now expands into real
   folder nodes matching the on-disk/remote hierarchy rather than a flat file list;
   confirm a folder appearing under two different status groups renders as two
   independent nodes (no cross-group merging); confirm the group-level file count is
   unchanged; if a flatten toggle ships, confirm switching it reproduces today's flat
   view exactly.

12. **Regression:** `npm test` stays at 41/42 or better; smoke-test existing
   upload/download/diff/sync.

13. **Upstream hygiene:** `git diff upstream/develop` stays additive/modular; each
   feature branch is PR-able; no CRLF committed.

## Open considerations

- Final config field name: `downloadPath` vs `localDownloadPath` (plan uses `downloadPath`).
- Whether `Download (Force)` should honor the redirect (plan says yes — same user intent).
- For "Modified" detection on large folders, content hashing is optional/config-gated;
  default to size+mtime like sync to keep it fast.
- Feature 2: whether to adopt the already-installed but currently-unused `p-queue@2.4.2`
  in place of the hand-rolled `Scheduler`, or leave `Scheduler` alone to minimize diff
  surface; lazy vs. eager connection-pool growth; sane max pool size per profile.
- Feature 3: default value for `confirmOverwrite` (plan defaults to `false`/silent for
  back-compat — open whether new installs should default to `'confirm'` instead, since
  silent overwrite is the actual pain point motivating this feature); per-file vs.
  batched "N files will be overwritten" prompt for folder-level commands.
- Feature 4: exact config field name and whether diff-only is a flag on the existing
  Download/Upload commands or a separate "smart" command variant; whether it should
  ever apply to single-file commands (plan says no — no diff concept for a lone
  target).
- Feature 5: whether compare's progress ships indeterminate first (fast to land,
  weaker UX) or waits for Feature 2's scheduler integration so both features land
  together with a determinate bar; whether to centralize `withProgress` into
  `createFileHandler` now or keep it local to the two call sites to minimize diff
  surface on a shared file.
- Feature 6: UX for the plaintext→SecretStorage migration prompt (auto vs. opt-in);
  whether to support a team-shared secret path at all, or explicitly document
  SecretStorage as single-machine and rely on Feature 7 (relocated, per-machine config)
  for teams that need to keep `sftp.json` out of VCS entirely.
- Feature 7: whether `workspaceContains:**/sftp.json` is broad enough (vs. always using
  `onStartupFinished`, which activates on every workspace open — a small cost/benefit
  tradeoff worth confirming against current activation-time metrics).
- Feature 9 *(speculative)*: whether this is worth building at all before it's tried —
  the existing flat list + `description` suffix already conveys folder context without
  extra clicks to expand; ship behind a toggle (default off, or a quick user survey)
  rather than replacing the current view outright if there's any doubt it's an
  improvement.

- Upstream PRs to file from the baseline repairs: createCommand import fix, paths.ts
  revert (or a properly typed re-do of the casing fix), Jest preprocessor fix, and the
  `remoteTimeOffsetInHours` round-trip bug.
</content>

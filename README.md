# sftp sync extension for VS Code

New maintained and updated version by [@Natizyskunk](https://github.com/Natizyskunk/) 😀 <!-- and [@satiromarra](https://github.com/satiromarra) --> <br>
(Forked from the no longer maintained [liximomo's SFTP plugin](https://github.com/liximomo/vscode-sftp.git))

- VS Code marketplace : https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp <br>
- VSIX release : https://github.com/Natizyskunk/vscode-sftp/releases/

✳ I would be more than happy to have you participate in one way or another to this project. You can do so by simply following the [templates](https://github.com/Natizyskunk/vscode-sftp/issues/new/choose) when you open a new issue or a new pull request.

## ℹ INFOS - 2025/03/13
I've tried to keep this extension up-to-date as much as I can and added a lot of new relevant features. Saddly, for the last year and a half I wasn't really able to work on the project because of personal reasons and I'm really not sure if and when I'll be able to get more time to work on it again. So for now consider the [v1.16.3](https://github.com/Natizyskunk/vscode-sftp/releases/tag/v1.16.3) as the latest official stable release available.

## ℹ INFOS - 2023/06/23
This is the main repository for the SFTP extension since [@liximomo](https://github.com/liximomo) has set his own to deprecated in favor of this one in the VSCode marketplace.
There are also other forks that are available. Feel free to try them.

A lot of work as been brought to fix bugs, add new features and more than 50 updates have been released with a lot of improvements and stability fixes for almost two years now. 😎

I've been working hard to fix a lot of things and I've updated more than 50 new releases with a lot of improvements and stability fixes and I've brought new features for almost three years now. 

---

VSCode-SFTP enables you to add, edit or delete files within a local directory and have it sync to a remote server directory using different transfer protocols like FTP or SSH. The most basic setup requires only a few lines of configuration with a wide array of specific settings also available to meet the needs of any user. Both powerful and fast, it helps developers save time by allowing the use of a familiar editor and environment.

- Features
  - [Browser remote with Remote Explorer](#remote-explorer)
  - [Folder Compare](#folder-compare)
  - Compare selected file(s) against remote
  - Diff local and remote
  - Sync directory
  - Upload/Download
  - Upload on save
  - File Watcher
  - Multiple configurations
  - Switchable profiles
  - Temp File support
- [Roadmap](#roadmap)
- [Commands](https://github.com/Natizyskunk/vscode-sftp/wiki/Commands)
- [Debug](#debug)
- [FAQ](#FAQ)

## Roadmap

Status of the features being built on top of upstream in this fork. See the full plan
in [.planning/fork-sftp-plan.md](.planning/fork-sftp-plan.md).

### ✅ Shipped

- **Folder Compare** — compare a local folder against its remote counterpart; see
  [Folder Compare](#folder-compare) below.
- **Folder Compare group actions** — right-click a group header to download, upload,
  match timestamps, or delete every file in that category at once, with modal confirms
  for destructive/overwriting actions.
- **Compare selected file(s)** — right-click one or more files (in the explorer, the
  Remote Explorer, or an editor tab) and load just those into the Folder Compare view,
  instead of walking a whole folder. Refresh re-runs the same selection rather than
  widening to the parent folder.
- **Diff with Local** — a Remote Explorer file action that diffs a remote file against
  its local counterpart (the mirror of `Diff with Remote` from the local side).
- **SFTP context-menu submenu** — the SFTP actions in the shared VS Code menus (file
  explorer, editor context, editor tab) are grouped under a single `SFTP` submenu so
  they stop crowding menus alongside other extensions. SFTP-owned views keep their
  actions flat.
- **Clear Compare** — a button in the Folder Compare view's title bar (next to
  Refresh) that resets the view back to empty on demand, instead of a stale result
  sitting there until the next re-compare. Non-destructive: it only discards the
  in-memory tree, never files.
- **Folder Compare path grouping** — switch between the existing flat status lists
  and a persisted Group by Path tree. Status groups, counts, and whole-group actions
  stay intact in both layouts.
- **Folder Compare reveal and per-file delete** — reveal compare files/path folders in
  the local or Remote Explorer where that side exists. New Remote files can be deleted
  on the remote and New Local files can be deleted locally, each behind a modal warning
  naming the exact path.

### 🚧 In progress

- **Staged Transfer Workflow (overwrite confirmation + diff-only transfer)** — two
  per-profile settings, off by default, that govern explicit uploads/downloads:
  - `confirmOverwrite` (`true`/`"confirm"`): a single-file transfer prompts before
    overwriting an existing destination file. A folder/project/multi-file transfer
    first classifies both sides (cancellable "checking" notification) and shows one
    counts modal — *N new, N will be overwritten (modified / timestamp-only),
    N identical* — with **Transfer**, **Review in Compare View** (loads the
    classification into Folder Compare and aborts; act from there, then Clear), and
    **Cancel**. When nothing would be overwritten, the transfer proceeds with a
    passive summary instead of a modal. `Upload to All Profiles` shows one modal per
    profile with **Skip This Profile** / **Cancel** (no Review — the Compare view
    binds to the active profile).
  - `skipUnmodified` (`true`): explicit folder/project/multi-file transfers skip
    files already identical on the destination (same size+mtime basis as Sync and
    Folder Compare; size-only on FTP — and note the staging walk is a full recursive
    listing, which is slow on large FTP trees). Single-file commands still transfer
    their one named file.

  Both flags stay orthogonal: with `skipUnmodified` off, identical files still
  transfer (explicit transfer means "force this exact state"). With both off,
  behavior is byte-for-byte the historical silent one-click transfer with zero extra
  round-trips. Sync, Force (Alt-click), the Compare-view actions, Edit-in-Local, and
  the implicit paths (uploadOnSave, downloadOnOpen, watcher auto-upload) never prompt,
  never stage, never skip. Files added or changed between the check and the transfer
  move unconfirmed (advisory guard, not a lock). Third-party keybindings invoking the
  hidden `sftp.upload`/`sftp.download` commands will hit the same gates when the flag
  is on. Implemented on `integration`; pending review.

- **Transfer progress & pause/resume/stop** — explicit multi-file operations (sync,
  folder/project transfers, multi-select) show a determinate per-file progress
  notification (*12/40 — file.js*) with a **Cancel** button that stops that operation
  only (queued files dropped; in-flight files finish — a clean stop between files).
  While such an operation runs, a status-bar control pauses/resumes **all** transfers
  globally (paused operations keep their queue and show *Paused — 12/40*); the same is
  available as `SFTP: Pause All Transfers` / `SFTP: Resume All Transfers`, and
  `SFTP: Cancel All Transfers (Stop)` remains the global stop. Folder Compare's walk
  shows a cancellable live counter (indeterminate — the total isn't known until the
  parallel-transfer work lands). Single-file transfers and the implicit paths
  (uploadOnSave, downloadOnOpen, watcher) keep the plain status-bar spinner and never
  pop notifications. Implemented on `integration`; pending review.

### 📋 Upcoming
- **Multi-threaded / parallel upload, download & checks** — pool multiple SFTP
  connections per profile instead of serializing every transfer over one channel, and
  bring folder-compare's directory walk under the same concurrency control.
- **Progress indication for compare & sync** — a real progress notification for
  these two multi-file operations, with pause/resume/stop controls, in place of
  the current blunt status-bar spinner.
- **Password security in config** — move stored passwords out of plaintext
  `.vscode/sftp.json` and into VS Code's `SecretStorage`, with a migration path for
  existing configs.
- **Custom location for the SFTP config file** — a `sftp.configPath` setting so the
  config can live outside `.vscode/` (or outside the repo entirely).
- **Configurable download location** — a per-profile `downloadPath` so explicit
  downloads land outside the working `context` folder, preserving the remote-relative
  subpath.
- **Settings GUI** — a webview-based settings editor for `sftp.json` (deferred, no
  timeline yet).

## Installation

### Method 1 (Recommended : Auto update)
1. Select Extensions (Ctrl + Shift + X).
2. Uninstall current sftp extension from @liximomo.
3. Install new extension directly from VS Code Marketplace : https://marketplace.visualstudio.com/items?itemName=Natizyskunk.sftp.
4. Voilà!

### Method 2 (Manual update)
To install just follow these steps from within VSCode:
1. Select Extensions (Ctrl + Shift + X).
2. Uninstall current sftp extension from @liximomo.
3. Open "More Action" menu(ellipsis on the top) and click "Install from VSIX…".
4. Locate VSIX file and select.
5. Reload VSCode.
6. Voilà!

## Documentation
- [Home](https://github.com/Natizyskunk/vscode-sftp/wiki)
- [Settings](https://github.com/Natizyskunk/vscode-sftp/wiki/Setting)
- [Common configuration](https://github.com/Natizyskunk/vscode-sftp/wiki/Common-Configuration)
- [SFTP configuration](https://github.com/Natizyskunk/vscode-sftp/wiki/SFTP-only-Configuration)
- [FTP confriguration](https://github.com/Natizyskunk/vscode-sftp/wiki/FTP(s)-only-Configuration)
- [Commands](https://github.com/Natizyskunk/vscode-sftp/wiki/Commands)

## Usage
If the latest files are already on a remote server, you can start with an empty local folder,
then download your project, and from that point sync.

1. In `VS Code`, open a local directory you wish to sync to the remote server (or create an empty directory
that you wish to first download the contents of a remote server folder in order to edit locally).
2. `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on Mac open command palette, run `SFTP: config` command.
3. A basic configuration file will appear named `sftp.json` under the `.vscode` directory, open and edit the configuration parameters with your remote server information.

For instance:
```json
{
    "name": "Profile Name",
    "host": "name_of_remote_host",
    "protocol": "ftp",
    "port": 21,
    "secure": true,
    "username": "username",
    "remotePath": "/public_html/project", // <--- This is the path which will be downloaded if you "Download Project"
    "password": "password",
    "uploadOnSave": false
}
```
The password parameter in `sftp.json` is optional, if left out you will be prompted for a password on sync.
_Note：_ backslashes and other special characters must be escaped with a backslash.

4. Save and close the `sftp.json` file.
5. `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on Mac open command palette.
6. Type `sftp` and you'll now see a number of other commands. You can also access many of the commands from the project's file explorer context menus.
7. A good one to start with if you want to sync with a remote folder is `SFTP: Download Project`.  This will download the directory shown in the `remotePath` setting in `sftp.json` to your local open directory.
8. Done - you can now edit locally and after each save it will upload to sync your remote file with the local copy.
9. Enjoy!

For detailed explanations please go to [wiki](https://github.com/Natizyskunk/vscode-sftp/wiki).

## Example configurations
You can see the full list of configuration options [here](https://github.com/Natizyskunk/vscode-sftp/wiki/configuration).

- [sftp sync extension for VS Code](#sftp-sync-extension-for-vs-code)
  - [Installation](#installation)
    - [Method 1 (Recommended : Auto update)](#method-1-recommended--auto-update)
    - [Method 2 (Manual update)](#method-2-manual-update)
  - [Documentation](#documentation)
  - [Usage](#usage)
  - [Example configurations](#example-configurations)
    - [Simple](#simple)
    - [Profiles](#profiles)
    - [Multiple Context](#multiple-context)
    - [Connection Hopping](#connection-hopping)
      - [Single Hop](#single-hop)
      - [Multiple Hop](#multiple-hop)
    - [Configuration in User Setting](#configuration-in-user-setting)
  - [Remote Explorer](#remote-explorer)
    - [Multiple Select](#multiple-select)
    - [Order](#order)
  - [Debug](#debug)
  - [FAQ](#faq)
  - [Donation](#donation)
    - [Buy Me a Coffee](#buy-me-a-coffee)
    - [PayPal](#paypal)

### Simple
```json
{
  "host": "host",
  "username": "username",
  "remotePath": "/remote/workspace"
}
```

### Profiles
```json
{
  "username": "username",
  "password": "password",
  "remotePath": "/remote/workspace/a",
  "watcher": {
    "files": "dist/*.{js,css}",
    "autoUpload": false,
    "autoDelete": false
  },
  "profiles": {
    "dev": {
      "host": "dev-host",
      "remotePath": "/dev",
      "uploadOnSave": true
    },
    "prod": {
      "host": "prod-host",
      "remotePath": "/prod"
    }
  },
  "defaultProfile": "dev"
}
```

_Note：_ `context` and `watcher` are only available at root level.

Use `SFTP: Set Profile` to switch profile.

### Multiple Context
The context must **not be same**.
```json
[
  {
    "name": "server1",
    "context": "project/build",
    "host": "host",
    "username": "username",
    "password": "password",
    "remotePath": "/remote/project/build"
  },
  {
    "name": "server2",
    "context": "project/src",
    "host": "host",
    "username": "username",
    "password": "password",
    "remotePath": "/remote/project/src"
  }
]
```

_Note：_ `name` is required in this mode.

### Connection Hopping
You can connect to a target server through a proxy with ssh protocol.

_Note：_ Variable substitution is not working in a hop configuration.

#### Single Hop
local -> hop -> target
```json
{
  "name": "target",
  "remotePath": "/path/in/target",

  // hop
  "host": "hopHost",
  "username": "hopUsername",
  "privateKeyPath": "/Users/localUser/.ssh/id_rsa", // <-- The key file is assumed on the local.

  "hop": {
    // target
    "host": "targetHost",
    "username": "targetUsername",
    "privateKeyPath": "/Users/hopUser/.ssh/id_rsa", // <-- The key file is assumed on the hop.
  }
}
```

#### Multiple Hop
local -> hopa -> hopb -> target
```json
{
  "name": "target",
  "remotePath": "/path/in/target",

  // hopa
  "host": "hopAHost",
  "username": "hopAUsername",
  "privateKeyPath": "/Users/hopAUsername/.ssh/id_rsa" // <-- The key file is assumed on the local.

  "hop": [
    // hopb
    {
      "host": "hopBHost",
      "username": "hopBUsername",
      "privateKeyPath": "/Users/hopaUser/.ssh/id_rsa" // <-- The key file is assumed on the hopa.
    },

    // target
    {
      "host": "targetHost",
      "username": "targetUsername",
      "privateKeyPath": "/Users/hopbUser/.ssh/id_rsa", // <-- The key file is assumed on the hopb.
    }
  ]
}
```

### Configuration in User Setting
You can use `remote` to tell sftp to get the configuration from [remote-fs](https://github.com/liximomo/vscode-remote-fs).

In User Setting:
```json
"remotefs.remote": {
  "dev": {
    "scheme": "sftp",
    "host": "host",
    "username": "username",
    "rootPath": "/path/to/somewhere"
  },
  "projectX": {
    "scheme": "sftp",
    "host": "host",
    "username": "username",
    "privateKeyPath": "/Users/xx/.ssh/id_rsa",
    "rootPath": "/home/foo/some/projectx"
  }
}
```

In sftp.json:
```json
{
  "remote": "dev",
  "remotePath": "/home/xx/",
  "uploadOnSave": false,
  "ignore": [".vscode", ".git", ".DS_Store"]
}
```

## Folder Compare

Compare a local folder with its remote counterpart and see, per file, what differs:

- **Modified** — exists on both sides but the content differs (size differs, or same size with a differing modification time).
- **Timestamp Only** — identical size but the modification time differs. On FTP this is skipped (LIST mtimes are unreliable), so the group only appears for SFTP.
- **New Remote** — exists only on the remote.
- **New Local** — exists only locally.

How to use it:

1. Right-click a folder in the explorer (or a folder in the Remote Explorer), open the `SFTP` submenu, and pick `Compare Folder with Remote`; or run `SFTP: Compare Active Folder with Remote` from the command palette.
2. The **Folder Compare** view in the SFTP activity bar container shows the groups above (empty groups are hidden). `ignore` rules from your config apply.
3. Open the view's `...` menu and choose **Group by Path** to nest folders below each
   status, or **Show Flat List** to restore the filename + parent-path list. The choice
   is saved for the workspace; switching layout does not re-run comparison.
4. Click a _Modified_ or _Timestamp Only_ entry to open a diff. Use the per-entry inline actions to download, upload, or match-timestamp an entry; the comparison re-runs afterwards. The refresh button re-runs the comparison at any time; the clear button next to it empties the view.

To compare just a **file or a handful of files**, select them (in the explorer, the Remote Explorer, or an editor tab), open the `SFTP` submenu, and pick `Compare File with Remote`. Only those files load into the view, and **Refresh** re-runs that same selection instead of widening to the parent folder. From a Remote Explorer file you can also pick `Diff with Local` to open a direct diff of that remote file against its local copy.

Right-click a compare file or a path folder to reveal it on the side guaranteed to
exist by its status:

| Status | Reveal | Per-file delete |
| --- | --- | --- |
| **Modified** / **Timestamp Only** | Local Explorer and Remote Explorer | None |
| **New Remote** | Remote Explorer | **Delete on Remote** (modal confirm) |
| **New Local** | Local Explorer | **Delete Locally** (modal confirm) |

Delete warnings name the exact relative path and affect only that file. Path-folder
nodes are organizational: they can be revealed, but cannot be transferred or deleted
as a batch.

### Group (whole-category) actions

Right-click a **group header** to act on every file in that category at once. The offered actions are context-aware, and the destructive ones require a modal confirmation naming the file count:

| Group | Actions |
| --- | --- |
| **Modified** | **Download from Remote** / **Upload to Remote** — overwrite one side with the other (confirm; cannot be undone). |
| **Timestamp Only** | **Match Timestamp (Use Remote)** / **Match Timestamp (Use Local)** — align mtimes without transferring content (no confirm). |
| **New Remote** | **Download from Remote** — pull all remote-only files locally. **Delete on Remote** — remove them from the server (confirm). |
| **New Local** | **Upload to Remote** — push all local-only files. **Delete Locally** — remove them from disk (confirm). |

Files are processed sequentially (FTP serializes on a single control connection), then the comparison refreshes once.

_Note:_ with a non-zero `remoteTimeOffsetInHours` the _Modified_ group may over-report changes (known upstream time-offset round-trip issue).

## Remote Explorer
![remote-explorer-preview](https://raw.githubusercontent.com/Natizyskunk/vscode-sftp/master/assets/showcase/remote-explorer.png)

Remote Explorer lets you explore files in remote. You can open Remote Explorer by:

1. Run Command `View: Show SFTP`.
2. Click SFTP view in Activity Bar.

You can only view a files content with Remote Explorer. Run command `SFTP: Edit in Local` to edit it in local.

### Multiple Select
You are able to select multiple files/folders at once on the remote server to download and upload. You can do it simply by holding down Ctrl or Shift while selecting all desired files, just like on the regular explorer view.

_Note：_ You need to manually refresh the parent folder after you **delete** a file if the explorer isn't correctly updated.

### Order
You can order the remote Explorer by adding the `remoteExplorer.order` parameter inside your `sftp.json` config file.

In sftp.json:
```json
{
  "remoteExplorer": {
    "order": 1 // <-- Default value is 0.
  }
}
```

## Debug
1. Open User Settings.
  - On Windows/Linux - `File > Preferences > Settings`
  - On macOS - `Code > Preferences > Settings`
2. Set `sftp.debug` to `true` and reload vscode.
3. View the logs in `View > Output > sftp`.

## FAQ
You can see all the Frequently Asked Questions [here](./FAQ.md).

## Donation
If this project helped you reduce development time and you wish to contribute financially

### Buy Me a Coffee
[![Buy Me A Coffee](https://bmc-cdn.nyc3.digitaloceanspaces.com/BMC-button-images/custom_images/orange_img.png)](https://www.buymeacoffee.com/Natizyskunk)

### PayPal
<!-- [![PayPal](https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=BY89QD47D7MPS&source=url) -->
[![PayPal](https://www.paypalobjects.com/en_US/i/btn/btn_donate_SM.gif)](https://www.paypal.com/donate?business=DELD7APHHM3BC&no_recurring=0&currency_code=EUR)
[![PayPal Me](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://paypal.me/natanfourie)

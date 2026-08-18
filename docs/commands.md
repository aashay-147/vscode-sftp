## Common commands

### SFTP: Config
Create a new configuration file for a project.

### SFTP: Set Profile
Set the current profile.
           
#### KeyBindings Args
func(profileName: string)

### SFTP: Upload Active File
Upload the current file.

### SFTP: Upload Changed Files
Upload all files changed or created since the last commit to your Git.
Can be called by default keyboard shortcut `Ctrl+Alt+U`.

### SFTP: Upload Active Folder
Upload the entire folder the current file is located in.

### SFTP: Download Active File
Download the remote version of the current file and overwrite the local copy.

### SFTP: Download Active Folder
Download the entire folder the current file is located in.

*Note:* with [localDownloadPath](common_configuration.md#localdownloadpath) set, explicit downloads land under the mirror folder (preserving the remote structure), actions on files under the mirror map back to the true remote path, and explicit uploads of files outside the mirror are blocked.

### SFTP: Sync Local -> Remote
1. Any files that exist on both local and remote that have a different timestamp between local and remote are copied over.
2. Any files that only exist on the local are copied over.

You can change the default behavior by [syncOption](configuration.md#syncoption).

### SFTP: Sync Remote -> Local
Same as `Sync Local -> Remote`, but in the opposite direction.

### SFTP: Sync Both Directions
Compare file modification times, and will always perform the action that causes the newest file to be present in both locations.

*Only [skipCreate](configuration.md#syncoptionskipcreate) and [ignoreExisting](configuration.md#syncoptionignoreexisting) are valid for this command.*

### SFTP: List Active Folder
List the folder the current file is located in.

### sftp.upload
Upload file or folders.

#### KeyBindings Args
func(fspaths: string[])

### sftp.download
Download file or folders.

#### KeyBindings Args
func(fspaths: string[])

### SFTP: Cancel All Transfers (Stop)
Stop the current transfers (upload and download). Queued files are dropped; in-flight files finish.

### SFTP: Pause All Transfers (`sftp.transfer.pause`)
Pause all running transfer operations globally. Paused operations keep their queue and show *Paused - N/M* in their progress notification.

### SFTP: Resume All Transfers (`sftp.transfer.resume`)
Resume transfers previously paused with `Pause All Transfers`.

### SFTP: Open SSH in Terminal
Open a terminal in VSCode and auto login to a specific server.


## Folder Compare commands

### SFTP: Compare Folder with Remote (`sftp.compareFolder`)
Compare the selected folder (file explorer or Remote Explorer) against its remote counterpart and load the result into the Folder Compare view.

### SFTP: Compare Active Folder with Remote (`sftp.compareActiveFolder`)
Same comparison, run from the command palette for the folder containing the active file.

### SFTP: Compare File with Remote (`sftp.compareFile`)
Compare only the selected file(s) against the remote and load just those into the Folder Compare view. Refresh re-runs the same selection instead of widening to the parent folder.

### Refresh Comparison (`sftp.compare.refresh`)
Re-run the current comparison (view title bar).

### Clear Comparison (`sftp.compare.clear`)
Reset the Folder Compare view back to empty (view title bar, next to Refresh). Non-destructive: only the in-memory result is discarded, never files.

### Group by Path (`sftp.compare.groupByPath`) / Show Flat List (`sftp.compare.showFlat`)
Toggle the view layout between the flat status lists and a nested path tree (view `...` menu). The choice is persisted per workspace; switching does not re-run comparison.

### Diff with Local (`sftp.diffWithLocal`)
From a Remote Explorer file, open a diff of the remote file against its local counterpart (the mirror of `Diff with Remote`).


## Folder Compare - per-file actions

Inline and context-menu actions on a single compare entry. The comparison re-runs after a transfer or timestamp action.

- **Diff with Remote** (`sftp.compare.diff`) - open the local/remote diff (also runs on click for *Modified* / *Timestamp Only* entries).
- **Download from Remote** (`sftp.compare.download`) / **Upload to Remote** (`sftp.compare.upload`) - transfer just that file.
- **Match Timestamp (Use Remote/Use Local)** (`sftp.compare.stampFromRemote` / `sftp.compare.stampFromLocal`) - align the modification time without transferring content.
- **Reveal in Explorer / Reveal in Remote Explorer** (`sftp.compare.revealInExplorer` / `sftp.compare.revealInRemoteExplorer`) - jump to the file on the side guaranteed to exist by its status.
- **Delete on Remote** (`sftp.compare.deleteRemote`) / **Delete Locally** (`sftp.compare.deleteLocal`) - remove a *New Remote* / *New Local* file (modal confirmation naming the exact path).


## Folder Compare - group actions

These commands appear only on a **group header** in the Folder Compare view (not in the command palette). They act on every file in that status group and refresh the comparison once when done. Destructive actions prompt with a modal confirmation.

### Download from Remote (`sftp.compare.group.download`)
Download every file in the group (New Remote / Modified), overwriting the local copy. On a Modified group this overwrites local content and asks to confirm first.

### Upload to Remote (`sftp.compare.group.upload`)
Upload every file in the group (New Local / Modified), overwriting the remote copy. On a Modified group this overwrites remote content and asks to confirm first.

### Match Timestamp - Use Remote (`sftp.compare.group.stampFromRemote`)
For a Timestamp Only group, set each local file's modification time to match the remote. No content is transferred.

### Match Timestamp - Use Local (`sftp.compare.group.stampFromLocal`)
For a Timestamp Only group, set each remote file's modification time to match the local. No content is transferred.

### Delete on Remote (`sftp.compare.group.deleteRemote`)
Permanently delete every New Remote file from the server. Modal confirmation required.

### Delete Locally (`sftp.compare.group.deleteLocal`)
Permanently delete every New Local file from disk. Modal confirmation required.


## Alt commands
An alternative command can be found when pressing `Alt` while opening a menu.

### Force Download
Download file but disregard ignore rules.

### Force Upload
Upload file but disregard ignore rules.

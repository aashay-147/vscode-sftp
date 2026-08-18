## Common configuration

### name
A string to identify your configuration.

| Key | Value |
| --- | --- |
| *name* | *string* |

```json
{
  "name": "My Server"
}
```

### context
A path relative to the workspace root folder. <br>
Use this when you want to map a subfolder to the `remotePath`.

| Key | Value | Default |
| --- | --- | --- |
| *context* | *string* | *The workspace root.* |

```json
{
  "context": "/_subfolder_"
}
```

### protocol
Protocol to be used.

| Key | Value | Default |
| --- | --- | --- |
| *protocol* | `sftp` *or* `ftp` | `sftp` |

```json
{
  "protocol": "sftp"
}
```

### host
Hostname or IP address of the server.

| Key | Value |
| --- | --- |
| *host* | *string* |

```json
{
  "host": "server.example.com"
}
```

### port
Port number of the server.

| Key | Value |
| --- | --- |
| *port* | *integer* |

```json
{
  "port": 22
}
```

### username
Username for authentication.

| Key | Value |
| --- | --- |
| *username* | *string* |

```json
{
  "username": "user1"
}
```

### password
[!WARNING]
**Passwords are stored as plain-text!**

The password for password-based user authentication.

| Key | Value |
| --- | --- |
| *password* | *string* |

```json
{
  "password": "Password123"
}
```

### remotePath
The absolute path on the remote host.

| Key | Value | Default |
| --- | --- | --- |
| *remotePath* | *string* | `/` |

```json
{
  "remotePath": "/_subfolder_"
}
```

### filePerm
Set octal file permissions for new files.

| Key | Value | Default |
| --- | --- | --- |
| *filePerm* | *number* | `false` |

```json
{
  "filePerm": 644
}
```
 
### dirPerm
Set octal directory permissions for new directories.

| Key | Value | Default |
| --- | --- | --- |
| *dirPerm* | *number* | `false` |

```json
{
  "dirPerm": 750
}
```

### uploadOnSave
Upload on every save operation of VSCode.

| Key | Value | Default |
| --- | --- | --- |
| *uploadOnSave* | *boolean* | `false` |

```json
{
  "uploadOnSave": true
}
```

### useTempFile
Upload temp file on every save operation of VSCode to avoid breaking a webpage when a user accesses it while the file is still being uploaded (is incomplete).

| Key | Value | Default |
| --- | --- | --- |
| *useTempFile* | *boolean* | `false` |

```json
{
  "useTempFile": true
}
```

### openSsh
Enable atomic file uploads (*only supported by openSSH servers*).

| 💡 Important |
| :--- |
| *If set to* `true`*, the* `useTempFile` *option must also be set to* `true`.|

| Key | Value | Default |
| --- | --- | --- |
| *openSsh* | *boolean* | `false` |

```json
{
  "openSsh": true,
  "useTempFile": true
}
```

### downloadOnOpen
Download the file from the remote server whenever it is opened.

| Key | Value | Default |
| --- | --- | --- |
| *downloadOnOpen* | *boolean* | `false` |

```json
{
  "downloadOnOpen": true
}
```

### syncOption
Configure the behavior of the `Sync` command.

| Key | Value | Default |
| --- | --- | --- |
| *syncOption* | *object* | `{}` |

#### syncOption.delete
Delete extraneous files from destination directories.

| Key | Value |
| --- | --- |
| *syncOption.delete* | *boolean* |

#### syncOption.skipCreate
Skip creating new files on the destination.

| Key | Value |
| --- | --- |
| *syncOption.skipCreate* | *boolean* |

#### syncOption.ignoreExisting
Skip updating files that exist on the destination.

| Key | Value |
| --- | --- |
| *syncOption.ignoreExisting* | *boolean* |

#### syncOption.update
Update the destination only if a newer version is on the source filesystem.

| Key | Value |
| --- | --- |
| *syncOption.update* | *boolean* |

```json
{
  "syncOption": {
    "delete": true,
    "skipCreate": false,
    "ignoreExisting": false,
    "update": true
  },
}
```

### confirmOverwrite
Ask before an explicit upload/download overwrites an existing destination file. A single-file transfer prompts per file; a folder/project/multi-file transfer first classifies both sides and shows one summary modal (*N new, N will be overwritten, N identical*) with **Transfer**, **Review in Compare View**, and **Cancel**. Sync, Force transfers, Folder Compare actions, and the implicit paths (uploadOnSave, downloadOnOpen, watcher) never prompt. `"confirm"` behaves like `true`.

| Key | Value | Default |
| --- | --- | --- |
| *confirmOverwrite* | *boolean* or `"confirm"` | `false` |

```json
{
  "confirmOverwrite": true
}
```

### skipUnmodified
Skip files already identical on the destination during explicit folder/project/multi-file uploads/downloads (same size+mtime basis as Sync and Folder Compare; size-only on FTP). Single-file commands still transfer their one named file.

| Key | Value | Default |
| --- | --- | --- |
| *skipUnmodified* | *boolean* | `false` |

```json
{
  "skipUnmodified": true
}
```

### localDownloadPath
A **local mirror** for explicit transfers, decoupled from the workspace `context` mapping.

| Key | Value | Default |
| --- | --- | --- |
| *localDownloadPath* | *string* | *(unset — mirror off)* |

```json
{
  "localDownloadPath": "./_downloads"
}
```

Relative paths resolve against `context`; `~/` and absolute paths (including folders **outside** the workspace) are supported. Overridable per profile.

**Forward mapping (downloads).** Explicit downloads (`Download`, `Download File/Folder/Project`, `Download Active File/Folder`, `Force Download`, compare-view downloads) land under the mirror, preserving the remote folder structure: remote `/var/www/src/a.txt` with `remotePath: /var/www` downloads to `<mirror>/src/a.txt`.

**Inverse mapping (everything acting on a mirror file).** Any explicit action on a file *under* the mirror automatically maps back to the true remote path:

- **Upload** of `<mirror>/src/a.txt` goes to `/var/www/src/a.txt` — never to `/var/www/_downloads/...`.
- **Re-download** of a mirror file lands in place.
- **Folder Compare** of a mirror folder walks the matching remote folder (and comparing a remote folder walks its mirror counterpart).
- **Diff with Remote** compares against the true remote counterpart.

**Unaffected flows** keep the plain workspace `context` mapping: `uploadOnSave`, the watcher, `Sync` (all directions), `downloadOnOpen`, `Edit in Local`, the `List` commands, and `Upload Project`.

**Profiles.** Each profile may set its own `localDownloadPath` (a profile without the key inherits the root one). A profile switch takes effect on the next command — no reload. Caveats: *Upload ... to All Profiles* of a mirror file uploads per-profile — a profile whose own mirror doesn't contain the file is skipped; compare results made under one profile act against the *active* profile until you Refresh (Refresh re-derives everything from the active profile's settings).

**In-workspace mirrors and uploadOnSave.** A mirror inside the workspace (like `./_downloads`) is still part of the workspace mapping for implicit flows, so saving a mirror file with `uploadOnSave` on uploads it to `/remote/_downloads/...`. Fence it off with `"ignore": ["_downloads"]` if that matters to you.

### restrictUploadsToLocalDownloadPath
A safety fence for the mirror workflow: block explicit uploads of anything **outside** the mirror.

| Key | Value | Default |
| --- | --- | --- |
| *restrictUploadsToLocalDownloadPath* | *boolean* | `false` |

```json
{
  "restrictUploadsToLocalDownloadPath": true
}
```

When on (and `localDownloadPath` is set), explicit uploads — including `Upload Project`, `Upload Changed Files`, compare-view uploads, and `Sync Local ➞ Remote` / `Sync Both Directions` — of files outside the mirror are blocked with:

> `'<path>' is outside localDownloadPath (<base>) — upload blocked by restrictUploadsToLocalDownloadPath`

Multi-file selections drop the blocked files with one aggregate warning and transfer the rest. Without `localDownloadPath` the option is inert. `uploadOnSave` and the watcher are not gated (disable them instead if you don't want implicit uploads).

### ignore
Ignore can be used to ignore files and folders from sync, and even supports wildcards using `*`. <br>
This is the same behavior as gitignore, all paths relative to context of the current configuration.
 
| Key | Value | Default |
| --- | --- | --- |
| *ignore* | *string[]* | `[]` |
 
```json
{
  "ignore": [
    "/.vscode",
    "/.git",
    "/.cache",
    "/_subfolder_",
    ".DS_Store",
    "*.gz",
    "*.log"
  ],
}
```

### ignoreFile
Absolute path to the ignore file or Relative path relative to the workspace root folder.
 
| Key | Value |
| --- | --- |
| *ignoreFile* | *string* |
 
```json
{
  "ignoreFile": "/.vscode/sftp.json"
}
```

### watcher
Configure the behavior of the `watcher` command.

| Key | Value | Default |
| --- | --- | --- |
| *watcher* | *object* | `{}` |

#### watcher.files
Glob patterns that are watched and when edited outside of the VSCode editor are processed.

| 💡 Important |
| :--- |
| *Set* `uploadOnSave` *to* `false` *when you watch everything.*| 

| Key | Value |
| --- | --- |
| *watcher.files* | *string* |
 
#### watcher.autoUpload
Upload when the file changed.

| Key | Value |
| --- | --- |
| *watcher.autoUpload* | *boolean* |

#### watcher.autoDelete
Delete when the file is removed.

| Key | Value |
| --- | --- |
| *watcher.autoDelete* | *boolean* |
```json
{
  "watcher": {
    "files": "**/*",
    "autoUpload": true,
    "autoDelete": true
  },
}
```

### remoteTimeOffsetInHours
The number of hours difference between the local machine and the remote server (remote minus local).

| Key | Value | Default |
| --- | --- | --- |
| *remoteTimeOffsetInHours* | *number* | `0` |

```json
{
  "remoteTimeOffsetInHours": 3
}
```

### remoteExplorer
Configure the behavior of the `remoteExplorer` command.

| Key | Value | Default |
| --- | --- | --- | 
| *remoteExplorer* | *object* | `{}` |
 
#### remoteExplorer.filesExclude
Configure that patterns for excluding files and folders. <br>
The Remote Explorer decides which files and folders to show or hide based on this setting..

| Key | Value |
| --- | --- |
| *remoteExplorer.filesExclude* | *string[]* |

#### remoteExplorer.order

| Key | Value |
| --- | --- |
| *remoteExplorer.order* | *number* |
```json
{
  "remoteExplorer": {
    "filesExclude": [],
    "order": 0
  }
}
```

### concurrency
Lowering the concurrency could get more stability because some clients/servers have some sort of configured/hard coded limit.

| Key | Value | Default |
| --- | --- | --- |
| *concurrency* | *number* | `4` |

```json
{
  "concurrency": 3
}
```

### connectTimeout
The maximum connection time.

| Key | Value | Default |
| --- | --- | --- |
| *connectTimeout* | *number* | `10000` |

```json
{
  "connectTimeout": 15000
}
```

### limitOpenFilesOnRemote
Limit open file descriptors to the specific number in a remote server. <br>
Set to true for using default `limit(222)`.

| 💡 Important |
| :--- |
| *Do not set this unless you have to!* | 

| Key | Value | Default |
| --- | --- | --- |
| *limitOpenFilesOnRemote* | *mixed* | `false` |

```json
{
  "limitOpenFilesOnRemote": 15000
}
```

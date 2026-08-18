## Setting

There are a handful of VS Code settings available for SFTP Workbench, and they can be changed:

- On Windows/Linux: File --> Preferences --> Settings
- On macOS: Code --> Preferences --> Settings

These live in your VS Code user/workspace settings, not in `sftp.json` (per-server options are documented in the [configuration docs](configuration.md)).

### sftp.debug
Adds debugging output to the SFTP output panel. <br>
You can view the log in `View --> Output --> SFTP`. Changing this requires VSCode to be reloaded.

| Key | Value | Default |
| --- | --- | --- |
| *sftp.debug* | *boolean* | *false* |

```json
{
  "sftp.debug": true
}
```

### sftp.printDebugLog
Legacy alias for `sftp.debug` - either one turns the debug log on. Changing this requires VSCode to be reloaded.

| Key | Value | Default |
| --- | --- | --- |
| *sftp.printDebugLog* | *boolean* | *false* |

```json
{
  "sftp.printDebugLog": true
}
```

### sftp.downloadWhenOpenInRemoteExplorer
Change the default behavior from `View Content` to `Edit in Local` (download) when opening files in the Remote Explorer.

| Key | Value | Default |
| --- | --- | --- |
| *sftp.downloadWhenOpenInRemoteExplorer* | *boolean* | *false* |

```json
{
  "sftp.downloadWhenOpenInRemoteExplorer": true
}
```

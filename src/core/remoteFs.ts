import { Readable } from 'stream';
import upath from './upath';
import { promptForPassword } from '../host';
import logger from '../logger';
import app from '../app';
import { ConnectOption } from './remote-client/remoteClient';
import {
  FileSystem,
  RemoteFileSystem,
  SFTPFileSystem,
  FTPFileSystem,
} from './fs';
import {
  FileEntry,
  FileHandle,
  FileOption,
  FileStats,
} from './fs/fileSystem';
import localFs from './localFs';

type ConnectFsOption = ConnectOption & {
  protocol: string;
  remoteTimeOffsetInHours: number;
};

type AskForPasswd = (msg: string) => Promise<string | undefined>;

function hashOption(opiton) {
  return Object.keys(opiton)
    .map(key => opiton[key])
    .join('');
}

class KeepAliveRemoteFs {
  private isValid: boolean = false;

  private pendingPromise: Promise<RemoteFileSystem> | null;

  private fs: RemoteFileSystem;

  private readonly _askForPasswd: AskForPasswd;

  constructor(askForPasswd: AskForPasswd = promptForPassword) {
    this._askForPasswd = askForPasswd;
  }

  async getFs(option: ConnectFsOption): Promise<RemoteFileSystem> {
    if (this.isValid) {
      this.pendingPromise = null;
      return Promise.resolve(this.fs);
    }

    if (this.pendingPromise) {
      return this.pendingPromise;
    }

    const connectOption = Object.assign({}, option);
    // tslint:disable variable-name
    let FsConstructor: typeof SFTPFileSystem | typeof FTPFileSystem;
    if (option.protocol === 'sftp') {
      connectOption.debug = function debug(str) {
        const log = str.match(/^DEBUG(?:\[SFTP\])?: (.*?): (.*?)$/);

        if (log) {
          if (log[1] === 'Parser') return;
          logger.debug(`${log[1]}: ${log[2]}`);
        } else {
          logger.debug(str);
        }
      };
      FsConstructor = SFTPFileSystem;
    } else if (option.protocol === 'ftp') {
      connectOption.debug = function debug(str) {
        const log = str.match(/^\[connection\] (>|<) (.*?)(\\r\\n)?$/);

        if (!log) return;

        if (log[2].match(/200 NOOP/)) return;

        if (log[2].match(/^PASS /)) log[2] = 'PASS ******';

        logger.debug(`${log[1]} ${log[2]}`);
      };
      FsConstructor = FTPFileSystem;
    } else {
      throw new Error(`unsupported protocol ${option.protocol}`);
    }

    this.fs = new FsConstructor(upath, {
      clientOption: connectOption,
      remoteTimeOffsetInHours: option.remoteTimeOffsetInHours,
    });
    this.fs.onDisconnected(this.invalid.bind(this));

    app.sftpBarItem.showMsg('connecting...', connectOption.connectTimeout);
    this.pendingPromise = this.fs
      .connect(connectOption, {
        askForPasswd: this._askForPasswd,
      })
      .then(
        () => {
          app.sftpBarItem.reset();
          this.isValid = true;
          return this.fs;
        },
        err => {
          this.fs.end();
          this.invalid('error');
          throw err;
        }
      );

    return this.pendingPromise;
  }

  invalid(reason: string) {
    this.pendingPromise = null;
    this.fs.end();
    this.isValid = false;
  }

  end() {
    if (this.fs) {
      this.fs.end();
    }
  }
}

interface PoolMember {
  keepAlive: KeepAliveRemoteFs;
  // number of in-flight operations on this connection (streams count until
  // they finish flowing, not until the call that created them returns)
  active: number;
}

// A file handle produced by PooledFileSystem.open: fd-based calls (close,
// fstat, futimes, put-with-fd) must go back to the connection that opened it.
interface PooledFileHandle {
  member: PoolMember;
  fd: FileHandle;
}

// Feature 4: a pool of KeepAliveRemoteFs connections to one host (one fsTable
// entry). Grows lazily — starts with a single connection and only opens
// another when every existing one is busy and the cap allows it — so a config
// with maxConnections > 1 but light usage behaves exactly like today. With an
// effective pool size of 1 the raw RemoteFileSystem is handed out directly,
// keeping the default path byte-identical to the pre-pool behavior.
class PooledRemoteFs {
  private members: PoolMember[] = [];
  private facade: PooledFileSystem | null = null;
  private option: ConnectFsOption;
  private cap: number = 1;
  // Passwords/prompt answers entered interactively for the first connection,
  // reused so members 2..n don't re-prompt the user mid-transfer. In-memory
  // only, scoped to this pool, cleared on disposal and on connect failure.
  private _passwordCache: Map<string, string> = new Map();

  getFs(option: ConnectFsOption, poolSize: number): Promise<FileSystem> {
    this.option = option;
    // the cap follows the latest resolved config: a profile switch that only
    // changes maxConnections reuses this pool (the connect-hash ignores it)
    // but grows/stops-growing to the new limit from here on
    this.cap = Math.max(1, poolSize);

    if (this.members.length === 0) {
      this.members.push(this._createMember());
    }

    // always make sure the primary connection is up first, so connect errors
    // and interactive prompts surface exactly where they always have
    const primary = this._fsOf(this.members[0]);
    if (this.cap <= 1) {
      return primary;
    }

    if (!this.facade) {
      this.facade = new PooledFileSystem(upath, this);
    }
    return primary.then(() => this.facade!);
  }

  end() {
    this.members.forEach(member => member.keepAlive.end());
    this.members = [];
    this.facade = null;
    this._passwordCache.clear();
  }

  // least-busy member, opening a new connection when all are busy and the cap
  // allows — the lazy-growth policy
  _pick(): PoolMember {
    let best = this.members[0];
    for (const member of this.members) {
      if (member.active < best.active) {
        best = member;
      }
    }

    if (best.active > 0 && this.members.length < this.cap) {
      const member = this._createMember();
      this.members.push(member);
      return member;
    }

    return best;
  }

  _fsOf(member: PoolMember): Promise<RemoteFileSystem> {
    return member.keepAlive.getFs(this.option).catch(err => {
      // a failed connect may mean a cached answer went stale (changed
      // password, one-time code) — drop the cache so the next attempt prompts
      this._passwordCache.clear();
      throw err;
    });
  }

  _run<T>(fn: (fs: RemoteFileSystem) => Promise<T>): Promise<T> {
    return this._runOn(this._pick(), fn);
  }

  async _runOn<T>(
    member: PoolMember,
    fn: (fs: RemoteFileSystem) => Promise<T>
  ): Promise<T> {
    member.active += 1;
    try {
      const fs = await this._fsOf(member);
      return await fn(fs);
    } finally {
      member.active -= 1;
    }
  }

  private _createMember(): PoolMember {
    return {
      keepAlive: new KeepAliveRemoteFs(this._askForPasswd),
      active: 0,
    };
  }

  private _askForPasswd: AskForPasswd = async (msg: string) => {
    const cached = this._passwordCache.get(msg);
    if (cached !== undefined) {
      return cached;
    }

    const answer = await promptForPassword(msg);
    if (answer !== undefined) {
      this._passwordCache.set(msg, answer);
    }
    return answer;
  };
}

// The FileSystem handed out for pools bigger than 1: every call is dispatched
// to the least-busy live connection. Streams hold their connection's busy slot
// until they finish flowing; file handles remember their connection so
// fd-based calls route back to it (see PooledFileHandle).
class PooledFileSystem extends FileSystem {
  private readonly _pool: PooledRemoteFs;

  constructor(pathResolver, pool: PooledRemoteFs) {
    super(pathResolver);
    this._pool = pool;
  }

  readFile(path: string, option?: FileOption): Promise<string | Buffer> {
    return this._pool._run(fs => fs.readFile(path, option));
  }

  async open(path: string, flags: string, mode?: number): Promise<FileHandle> {
    const member = this._pool._pick();
    const fd = await this._pool._runOn(member, fs => fs.open(path, flags, mode));
    const handle: PooledFileHandle = { member, fd };
    return handle;
  }

  close(fd: FileHandle): Promise<void> {
    const handle = fd as PooledFileHandle;
    return this._pool._runOn(handle.member, fs => fs.close(handle.fd));
  }

  fstat(fd: FileHandle): Promise<FileStats> {
    const handle = fd as PooledFileHandle;
    return this._pool._runOn(handle.member, fs => fs.fstat(handle.fd));
  }

  futimes(fd: FileHandle, atime: number, mtime: number): Promise<void> {
    const handle = fd as PooledFileHandle;
    return this._pool._runOn(handle.member, fs =>
      fs.futimes(handle.fd, atime, mtime)
    );
  }

  async get(path: string, option?: FileOption): Promise<Readable> {
    const member = this._pool._pick();
    member.active += 1;
    let stream: Readable;
    try {
      const fs = await this._pool._fsOf(member);
      stream = await fs.get(path, option);
    } catch (error) {
      member.active -= 1;
      throw error;
    }

    // the call resolves as soon as the stream exists — keep the busy slot
    // held until the data actually finishes flowing
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        member.active -= 1;
      }
    };
    stream.once('end', release);
    stream.once('error', release);
    stream.once('close', release);
    return stream;
  }

  put(input: Readable, path, option?: FileOption): Promise<void> {
    if (option && option.fd) {
      const handle = option.fd as PooledFileHandle;
      return this._pool._runOn(handle.member, fs =>
        fs.put(input, path, { ...option, fd: handle.fd })
      );
    }

    return this._pool._run(fs => fs.put(input, path, option));
  }

  mkdir(dir: string): Promise<void> {
    return this._pool._run(fs => fs.mkdir(dir));
  }

  ensureDir(dir: string): Promise<void> {
    return this._pool._run(fs => fs.ensureDir(dir));
  }

  chmod(path: string, mode: number): Promise<void> {
    return this._pool._run(fs => fs.chmod(path, mode));
  }

  list(dir: string, option?): Promise<FileEntry[]> {
    return this._pool._run(fs => fs.list(dir, option));
  }

  lstat(path: string): Promise<FileStats> {
    return this._pool._run(fs => fs.lstat(path));
  }

  readlink(path: string): Promise<string> {
    return this._pool._run(fs => fs.readlink(path));
  }

  symlink(targetPath: string, path: string): Promise<void> {
    return this._pool._run(fs => fs.symlink(targetPath, path));
  }

  unlink(path: string): Promise<void> {
    return this._pool._run(fs => fs.unlink(path));
  }

  rmdir(path: string, recursive: boolean): Promise<void> {
    return this._pool._run(fs => fs.rmdir(path, recursive));
  }

  rename(srcPath: string, destPath: string): Promise<void> {
    return this._pool._run(fs => fs.rename(srcPath, destPath));
  }

  renameAtomic(srcPath: string, destPath: string): Promise<void> {
    return this._pool._run(fs => fs.renameAtomic(srcPath, destPath));
  }
}

function getLocalFs() {
  return Promise.resolve(localFs);
}

const fsTable: {
  [x: string]: PooledRemoteFs;
} = {};

export function createRemoteIfNoneExist(
  option,
  poolSize: number = 1
): Promise<FileSystem> {
  if (option.protocol === 'local') {
    return getLocalFs();
  }

  // defensive: FTP serializes on one control connection, never pool it
  const size = option.protocol === 'ftp' ? 1 : poolSize;

  const identity = hashOption(option);
  let pool = fsTable[identity];
  if (pool === undefined) {
    pool = new PooledRemoteFs();
    fsTable[identity] = pool;
  }
  return pool.getFs(option, size);
}

export function removeRemoteFs(option) {
  const identity = hashOption(option);
  const pool = fsTable[identity];
  if (pool !== undefined) {
    pool.end();
    delete fsTable[identity];
  }
}

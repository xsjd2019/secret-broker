import {
  openSync,
  closeSync,
  writeSync,
  unlinkSync,
  readFileSync,
  mkdirSync,
} from 'node:fs';
import { dirname } from 'node:path';

export class LockBusyError extends Error {
  constructor(
    message: string,
    public readonly holderPid: number,
  ) {
    super(message);
    this.name = 'LockBusyError';
  }
}

interface LockMeta {
  pid: number;
  ts: number;
}

function isPidAlive(pid: number): boolean {
  try {
    // signal 0 is a permission/existence check, doesn't actually signal
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as { code?: string }).code;
    // ESRCH = no such process. EPERM = exists but we can't signal it
    // (still alive). Anything else = treat as dead.
    return code === 'EPERM';
  }
}

/**
 * Acquire an exclusive on-disk lock for the duration of `fn`.
 *
 *  - If the lock file already exists and holds a LIVE pid, throw
 *    `LockBusyError` (so callers can show a clear "request already in
 *    progress" message rather than spawning a duplicate dialog).
 *  - If the lock holds a DEAD pid, reap it and proceed (handles
 *    crashed-mid-request cases).
 *  - On normal completion or thrown error, the lock file is removed.
 */
export async function withLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  mkdirSync(dirname(lockPath), { recursive: true });

  let fd: number;
  try {
    // O_EXCL ensures only one process can create the lock file.
    fd = openSync(lockPath, 'wx', 0o600);
  } catch (e) {
    if ((e as { code?: string }).code !== 'EEXIST') throw e;
    // Lock exists. Inspect it to decide reap vs busy.
    let meta: LockMeta | null = null;
    try {
      meta = JSON.parse(readFileSync(lockPath, 'utf8')) as LockMeta;
    } catch {
      // Corrupt lock file — treat as stale and reap.
    }
    if (meta && isPidAlive(meta.pid)) {
      throw new LockBusyError(
        `Another secret-broker request is already in progress (pid ${meta.pid}).`,
        meta.pid,
      );
    }
    // Stale lock — remove and retry once.
    try { unlinkSync(lockPath); } catch { /* race-safe */ }
    fd = openSync(lockPath, 'wx', 0o600);
  }

  try {
    const meta: LockMeta = { pid: process.pid, ts: Date.now() };
    writeSync(fd, JSON.stringify(meta));
  } finally {
    closeSync(fd);
  }

  try {
    return await fn();
  } finally {
    try { unlinkSync(lockPath); } catch { /* already removed */ }
  }
}

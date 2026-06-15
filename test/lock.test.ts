import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withLock, LockBusyError } from '../src/lock.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'secret-broker-lock-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('withLock', () => {
  test('runs the function while holding the lock', async () => {
    const lock = join(tmp, 'x.lock');
    let ran = false;
    await withLock(lock, async () => {
      ran = true;
      expect(existsSync(lock)).toBe(true);
    });
    expect(ran).toBe(true);
  });

  test('removes the lock file after completion', async () => {
    const lock = join(tmp, 'x.lock');
    await withLock(lock, async () => {});
    expect(existsSync(lock)).toBe(false);
  });

  test('removes the lock file even if the function throws', async () => {
    const lock = join(tmp, 'x.lock');
    await expect(
      withLock(lock, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  test('throws LockBusyError when lock is held by a fresh, live process', async () => {
    const lock = join(tmp, 'x.lock');
    // Simulate a live holder by writing OUR pid (which is always alive
    // while this test runs)
    writeFileSync(lock, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    await expect(
      withLock(lock, async () => {}),
    ).rejects.toBeInstanceOf(LockBusyError);
  });

  test('reaps a stale lock from a dead pid', async () => {
    const lock = join(tmp, 'x.lock');
    // Use pid 999999 which is unlikely to exist
    writeFileSync(lock, JSON.stringify({ pid: 999_999, ts: Date.now() }));
    let ran = false;
    await withLock(lock, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  test('creates parent directories', async () => {
    const lock = join(tmp, 'deep', 'nested', 'x.lock');
    await withLock(lock, async () => {});
    // parent dir should exist after the call (even though lock file got
    // cleaned)
    expect(statSync(join(tmp, 'deep', 'nested')).isDirectory()).toBe(true);
  });
});

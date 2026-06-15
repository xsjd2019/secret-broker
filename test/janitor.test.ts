import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepStaleTmp } from '../src/janitor.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'secret-broker-jan-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function touch(path: string, ageMs: number): void {
  writeFileSync(path, 'x');
  const t = (Date.now() - ageMs) / 1000;
  utimesSync(path, t, t);
}

describe('sweepStaleTmp', () => {
  test('returns 0 when directory does not exist', () => {
    const n = sweepStaleTmp(join(tmp, 'nope'), 5 * 60 * 1000);
    expect(n).toBe(0);
  });

  test('deletes files older than maxAgeMs', () => {
    const dir = join(tmp, 't');
    mkdirSync(dir);
    touch(join(dir, 'CF_TOKEN.1700000000000.1234'), 10 * 60 * 1000);
    const n = sweepStaleTmp(dir, 5 * 60 * 1000);
    expect(n).toBe(1);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  test('keeps files newer than maxAgeMs', () => {
    const dir = join(tmp, 't');
    mkdirSync(dir);
    touch(join(dir, 'CF_TOKEN.1700000000000.1234'), 1 * 60 * 1000);
    const n = sweepStaleTmp(dir, 5 * 60 * 1000);
    expect(n).toBe(0);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  test('skips files that do not match the expected pattern (safety)', () => {
    const dir = join(tmp, 't');
    mkdirSync(dir);
    // Wrong pattern (no .ts.pid suffix) — must not be deleted, even
    // if old. Defense-in-depth against accidental wipes of user data.
    touch(join(dir, 'some-other-file.txt'), 10 * 60 * 1000);
    const n = sweepStaleTmp(dir, 5 * 60 * 1000);
    expect(n).toBe(0);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  test('mixed: deletes only matching old files', () => {
    const dir = join(tmp, 't');
    mkdirSync(dir);
    touch(join(dir, 'A.1700000000000.111'), 10 * 60 * 1000); // old, matches → delete
    touch(join(dir, 'B.1700000000000.222'), 1 * 60 * 1000); // new, matches → keep
    touch(join(dir, 'unrelated.txt'), 10 * 60 * 1000); // old, no match → keep
    const n = sweepStaleTmp(dir, 5 * 60 * 1000);
    expect(n).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(
      ['B.1700000000000.222', 'unrelated.txt'].sort(),
    );
  });
});

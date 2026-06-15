import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveNamespace,
  namespaceFromPath,
} from '../src/namespace.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'secret-broker-ns-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function makeGitRepo(path: string): void {
  execFileSync('git', ['-C', path, 'init', '-q', '-b', 'main'], { stdio: 'pipe' });
  execFileSync('git', ['-C', path, 'config', 'user.email', 'a@b.c'], { stdio: 'pipe' });
  execFileSync('git', ['-C', path, 'config', 'user.name', 't'], { stdio: 'pipe' });
}

describe('namespaceFromPath', () => {
  test('is deterministic', () => {
    expect(namespaceFromPath('/a/b/c')).toBe(namespaceFromPath('/a/b/c'));
  });

  test('returns a 16-char hex string', () => {
    const ns = namespaceFromPath('/a/b/c');
    expect(ns).toMatch(/^[0-9a-f]{16}$/);
  });

  test('differs for different paths', () => {
    expect(namespaceFromPath('/a')).not.toBe(namespaceFromPath('/b'));
  });
});

describe('resolveNamespace', () => {
  test('uses git root when cwd is inside a git repo', () => {
    makeGitRepo(tmp);
    const sub = join(tmp, 'sub', 'deep');
    mkdirSync(sub, { recursive: true });
    const r = resolveNamespace(sub);
    expect(r.source).toBe('git');
    // git root should resolve to the realpath of tmp, not the deep cwd
    expect(r.id).toBe(namespaceFromPath(r.path));
    expect(r.path.endsWith(tmp.split('/').pop()!)).toBe(true);
  });

  test('falls back to cwd when not in a git repo', () => {
    const r = resolveNamespace(tmp);
    expect(r.source).toBe('cwd');
    // resolveNamespace canonicalises via realpath so symlinks (e.g. macOS
    // /tmp -> /private/tmp) collapse to one namespace
    expect(r.id).toBe(namespaceFromPath(realpathSync(tmp)));
  });

  test('same git repo from different sub-paths yields same namespace', () => {
    makeGitRepo(tmp);
    const a = join(tmp, 'a');
    const b = join(tmp, 'b', 'c');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    expect(resolveNamespace(a).id).toBe(resolveNamespace(b).id);
  });

  test('different git repos yield different namespaces', () => {
    const other = mkdtempSync(join(tmpdir(), 'secret-broker-ns2-'));
    try {
      makeGitRepo(tmp);
      makeGitRepo(other);
      expect(resolveNamespace(tmp).id).not.toBe(resolveNamespace(other).id);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

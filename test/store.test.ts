import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  write600,
  dataDir,
  namespaceDir,
  secretPath,
  tmpDir,
  lockDir,
  APP_DIR_NAME,
} from '../src/store.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'secret-broker-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('write600', () => {
  test('writes file content', () => {
    const p = join(tmp, 'a', 'b', 'c.txt');
    write600(p, 'hello');
    expect(readFileSync(p, 'utf8')).toBe('hello');
  });

  test('creates parent directories', () => {
    const p = join(tmp, 'deep', 'nested', 'dir', 'file');
    write600(p, 'x');
    expect(statSync(join(tmp, 'deep', 'nested', 'dir')).isDirectory()).toBe(true);
  });

  test('sets mode 0600 on new file', () => {
    const p = join(tmp, 'new.bin');
    write600(p, 'x');
    const mode = statSync(p).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test('chmods existing file to 0600 (writeFileSync mode is ineffective on existing files)', () => {
    const p = join(tmp, 'existing.bin');
    // Pre-create with permissive mode
    writeFileSync(p, 'old', { mode: 0o644 });
    expect(statSync(p).mode & 0o777).toBe(0o644);
    write600(p, 'new');
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readFileSync(p, 'utf8')).toBe('new');
  });
});

describe('path layout', () => {
  test('dataDir defaults to ~/.config/secret-broker under given home', () => {
    expect(dataDir('/home/alice')).toBe(`/home/alice/.config/${APP_DIR_NAME}`);
  });

  test('dataDir uses XDG_CONFIG_HOME when env is set on call', () => {
    expect(dataDir('/home/alice', '/custom/xdg')).toBe(`/custom/xdg/${APP_DIR_NAME}`);
  });

  test('namespaceDir is dataDir/<ns>', () => {
    expect(namespaceDir('abc123', '/home/alice')).toBe(
      `/home/alice/.config/${APP_DIR_NAME}/abc123`,
    );
  });

  test('secretPath is dataDir/<ns>/<name>', () => {
    expect(secretPath('abc123', 'CF_TOKEN', '/home/alice')).toBe(
      `/home/alice/.config/${APP_DIR_NAME}/abc123/CF_TOKEN`,
    );
  });

  test('tmpDir is dataDir/<ns>/.tmp', () => {
    expect(tmpDir('abc123', '/home/alice')).toBe(
      `/home/alice/.config/${APP_DIR_NAME}/abc123/.tmp`,
    );
  });

  test('lockDir is dataDir/<ns>/.locks', () => {
    expect(lockDir('abc123', '/home/alice')).toBe(
      `/home/alice/.config/${APP_DIR_NAME}/abc123/.locks`,
    );
  });
});

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { aesGcmEncrypt, aesGcmDecrypt } from '../src/crypto.js';
import { secretPath, write600 } from '../src/store.js';
import { resolveNamespace } from '../src/namespace.js';
import { runWithSecrets } from '../src/commands/run.js';
import { getSecret } from '../src/commands/get.js';
import { listSecrets } from '../src/commands/ls.js';
import { importEnv } from '../src/commands/import-env.js';
import type { Context } from '../src/context.js';

let homeTmp: string;
let projectTmp: string;
let ctx: Context;

function makeCtx(home: string, projectPath: string): Context {
  const vmk = randomBytes(32);
  const ns = resolveNamespace(projectPath);
  return {
    vmk,
    namespace: ns,
    home,
    xdgConfigHome: undefined,
    account: 'test-user',
  };
}

function storeSecret(c: Context, name: string, value: string): void {
  const aad = `${c.namespace.id}:${name}:v2`;
  const path = secretPath(c.namespace.id, name, c.home, c.xdgConfigHome);
  write600(path, aesGcmEncrypt(c.vmk, value, aad));
}

beforeEach(() => {
  homeTmp = mkdtempSync(join(tmpdir(), 'sb-home-'));
  projectTmp = mkdtempSync(join(tmpdir(), 'sb-proj-'));
  ctx = makeCtx(homeTmp, projectTmp);
});

afterEach(() => {
  rmSync(homeTmp, { recursive: true, force: true });
  rmSync(projectTmp, { recursive: true, force: true });
});

describe('round-trip via the store layer', () => {
  test('encrypt → write600 → read → decrypt returns original', () => {
    storeSecret(ctx, 'CF_TOKEN', 'sk-cloudflare-test');
    const path = secretPath(ctx.namespace.id, 'CF_TOKEN', ctx.home, ctx.xdgConfigHome);
    const blob = readFileSync(path, 'utf8');
    const out = aesGcmDecrypt(
      ctx.vmk,
      blob,
      `${ctx.namespace.id}:CF_TOKEN:v2`,
    );
    expect(out).toBe('sk-cloudflare-test');
  });

  test('encrypted file is mode 0600', () => {
    storeSecret(ctx, 'X', 'val');
    const path = secretPath(ctx.namespace.id, 'X', ctx.home, ctx.xdgConfigHome);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test('cross-namespace decrypt fails (AAD bind works end-to-end)', () => {
    storeSecret(ctx, 'X', 'val');
    const otherProject = mkdtempSync(join(tmpdir(), 'sb-other-'));
    try {
      const otherCtx: Context = { ...ctx, namespace: resolveNamespace(otherProject) };
      const path = secretPath(ctx.namespace.id, 'X', ctx.home, ctx.xdgConfigHome);
      const blob = readFileSync(path, 'utf8');
      expect(() =>
        aesGcmDecrypt(otherCtx.vmk, blob, `${otherCtx.namespace.id}:X:v2`),
      ).toThrow();
    } finally {
      rmSync(otherProject, { recursive: true, force: true });
    }
  });
});

describe('run command (env injection)', () => {
  test('passes secret to child as env variable', () => {
    storeSecret(ctx, 'TEST_VAR', 'secret-value-xyz');
    // Child writes the env value to a file we can read back. We avoid
    // capturing stdout because `stdio: 'inherit'` bypasses
    // process.stdout.write (it goes straight to fd1 in the child).
    const outFile = join(projectTmp, 'child-out.txt');
    const code = runWithSecrets({
      names: ['TEST_VAR'],
      cmd: 'node',
      cmdArgs: [
        '-e',
        `require('fs').writeFileSync(process.argv[1], process.env.TEST_VAR || 'MISSING')`,
        outFile,
      ],
      ctx,
    });
    expect(code).toBe(0);
    expect(readFileSync(outFile, 'utf8')).toBe('secret-value-xyz');
  });

  test('returns non-zero when secret does not exist', () => {
    const code = runWithSecrets({
      names: ['DOES_NOT_EXIST'],
      cmd: 'true',
      cmdArgs: [],
      ctx,
    });
    expect(code).not.toBe(0);
  });

  test('returns child exit code', () => {
    storeSecret(ctx, 'X', 'v');
    const code = runWithSecrets({
      names: ['X'],
      cmd: 'sh',
      cmdArgs: ['-c', 'exit 42'],
      ctx,
    });
    expect(code).toBe(42);
  });
});

describe('get command (mode-600 path file)', () => {
  test('writes plaintext to a mode-600 file and prints path', () => {
    storeSecret(ctx, 'PATH_TEST', 'p-value');
    const lines: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string | Uint8Array) => {
      lines.push(c.toString());
      return true;
    }) as typeof process.stdout.write;
    let code: number;
    try {
      code = getSecret({ name: 'PATH_TEST', ctx });
    } finally {
      process.stdout.write = orig;
    }
    expect(code).toBe(0);
    const outPath = lines.join('').trim();
    expect(existsSync(outPath)).toBe(true);
    expect(statSync(outPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(outPath, 'utf8')).toBe('p-value');
  });

  test('returns non-zero when secret does not exist', () => {
    const code = getSecret({ name: 'NOPE', ctx });
    expect(code).not.toBe(0);
  });
});

describe('ls command (names only, no values)', () => {
  test('JSON output lists names and ISO timestamps; never values', () => {
    storeSecret(ctx, 'A_KEY', 'aaa');
    storeSecret(ctx, 'B_KEY', 'bbb');
    const lines: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string | Uint8Array) => {
      lines.push(c.toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      listSecrets({ ctx, json: true });
    } finally {
      process.stdout.write = orig;
    }
    const out = lines.join('');
    expect(out).toContain('A_KEY');
    expect(out).toContain('B_KEY');
    expect(out).not.toContain('aaa');
    expect(out).not.toContain('bbb');
    const parsed = JSON.parse(out);
    expect(parsed.entries.map((e: { name: string }) => e.name).sort()).toEqual(['A_KEY', 'B_KEY']);
  });

  test('hidden dirs (.tmp, .locks) are skipped', () => {
    storeSecret(ctx, 'REAL_KEY', 'x');
    // Create sibling hidden dirs that should never be reported
    mkdirSync(
      join(homeTmp, '.config', 'secret-broker', ctx.namespace.id, '.tmp'),
      { recursive: true },
    );
    mkdirSync(
      join(homeTmp, '.config', 'secret-broker', ctx.namespace.id, '.locks'),
      { recursive: true },
    );
    const lines: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string | Uint8Array) => {
      lines.push(c.toString());
      return true;
    }) as typeof process.stdout.write;
    try {
      listSecrets({ ctx, json: true });
    } finally {
      process.stdout.write = orig;
    }
    const parsed = JSON.parse(lines.join(''));
    expect(parsed.entries.map((e: { name: string }) => e.name)).toEqual(['REAL_KEY']);
  });
});

describe('import-env command', () => {
  test('imports a .env file and removes the need for plaintext', () => {
    const src = join(projectTmp, '.env.import');
    writeFileSync(src, 'CF_TOKEN=cf-abc\nLINE_TOKEN="line-xyz"\n# comment\n');
    const code = importEnv({ path: src, ctx });
    expect(code).toBe(0);

    // Verify both can be round-tripped
    const p1 = secretPath(ctx.namespace.id, 'CF_TOKEN', ctx.home, ctx.xdgConfigHome);
    const p2 = secretPath(ctx.namespace.id, 'LINE_TOKEN', ctx.home, ctx.xdgConfigHome);
    expect(
      aesGcmDecrypt(ctx.vmk, readFileSync(p1, 'utf8'), `${ctx.namespace.id}:CF_TOKEN:v2`),
    ).toBe('cf-abc');
    expect(
      aesGcmDecrypt(ctx.vmk, readFileSync(p2, 'utf8'), `${ctx.namespace.id}:LINE_TOKEN:v2`),
    ).toBe('line-xyz');
  });
});

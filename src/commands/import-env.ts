import { readFileSync, existsSync } from 'node:fs';
import { aesGcmEncrypt } from '../crypto.js';
import { aadFor, type Context } from '../context.js';
import { write600, secretPath } from '../store.js';
import { EXIT_ERROR, EXIT_OK } from '../exit-codes.js';

export interface ImportEnvOptions {
  path: string;
  ctx: Context;
}

/**
 * Parse a `.env`-style file into KEY=VALUE pairs.
 *
 * Supports:
 *  - lines like KEY=VALUE
 *  - leading "export "
 *  - VALUE surrounded by single or double quotes (stripped)
 *  - blank lines and `#` comment lines (ignored)
 *
 * Intentionally does NOT do shell-style $expansion or escape sequence
 * interpretation. If your .env has those, fix it before importing.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = val;
  }
  return out;
}

export function importEnv(opts: ImportEnvOptions): number {
  if (!existsSync(opts.path)) {
    process.stderr.write(`file not found: ${opts.path}\n`);
    return EXIT_ERROR;
  }
  const content = readFileSync(opts.path, 'utf8');
  const pairs = parseEnvFile(content);
  const names = Object.keys(pairs);
  if (names.length === 0) {
    process.stderr.write('no importable lines found\n');
    return EXIT_ERROR;
  }
  for (const name of names) {
    const value = pairs[name]!;
    const blob = aesGcmEncrypt(
      opts.ctx.vmk,
      value,
      aadFor(opts.ctx.namespace, name),
    );
    write600(
      secretPath(opts.ctx.namespace.id, name, opts.ctx.home, opts.ctx.xdgConfigHome),
      blob,
    );
  }
  process.stderr.write(
    `imported ${names.length} secret(s) into ns=${opts.ctx.namespace.id}.\n` +
      `→ delete or move the source file (${opts.path}) — plaintext is no longer needed.\n`,
  );
  return EXIT_OK;
}

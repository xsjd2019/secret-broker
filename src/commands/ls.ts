import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { namespaceDir } from '../store.js';
import type { Context } from '../context.js';
import { EXIT_OK } from '../exit-codes.js';

export interface LsOptions {
  ctx: Context;
  json?: boolean;
}

interface SecretEntry {
  name: string;
  storedAt: string; // ISO
}

/**
 * List secret names for the current namespace. Never prints values —
 * only names + creation time (mtime of the encrypted file).
 *
 * Hidden directories (`.tmp`, `.locks`) and non-files are skipped.
 */
export function listSecrets(opts: LsOptions): number {
  const dir = namespaceDir(
    opts.ctx.namespace.id,
    opts.ctx.home,
    opts.ctx.xdgConfigHome,
  );
  const entries: SecretEntry[] = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      entries.push({
        name,
        storedAt: new Date(st.mtimeMs).toISOString(),
      });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ namespace: opts.ctx.namespace, entries }, null, 2) + '\n',
    );
  } else {
    process.stderr.write(
      `namespace: ${opts.ctx.namespace.id} (${opts.ctx.namespace.source}=${opts.ctx.namespace.path})\n`,
    );
    if (entries.length === 0) {
      process.stderr.write('(no secrets)\n');
    } else {
      const w = Math.max(...entries.map((e) => e.name.length));
      for (const e of entries) {
        process.stdout.write(`${e.name.padEnd(w)}  ${e.storedAt}\n`);
      }
    }
  }
  return EXIT_OK;
}

import { unlinkSync, existsSync } from 'node:fs';
import { secretPath } from '../store.js';
import type { Context } from '../context.js';
import { EXIT_ERROR, EXIT_OK } from '../exit-codes.js';

export interface RmOptions {
  name: string;
  ctx: Context;
}

export function removeSecret(opts: RmOptions): number {
  const path = secretPath(
    opts.ctx.namespace.id,
    opts.name,
    opts.ctx.home,
    opts.ctx.xdgConfigHome,
  );
  if (!existsSync(path)) {
    process.stderr.write(`not found: ${opts.name}\n`);
    return EXIT_ERROR;
  }
  unlinkSync(path);
  process.stderr.write(`removed ${opts.name}\n`);
  return EXIT_OK;
}

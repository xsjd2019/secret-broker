import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { aesGcmDecrypt } from '../crypto.js';
import { aadFor, type Context } from '../context.js';
import { secretPath } from '../store.js';
import { EXIT_ERROR, EXIT_OK } from '../exit-codes.js';

export interface RunOptions {
  names: string[];
  cmd: string;
  cmdArgs: string[];
  ctx: Context;
}

/**
 * Decrypt one or more secrets and exec a child process with them
 * injected as environment variables. Values never appear on stdout,
 * disk, argv, or process listings — they live only in the spawned
 * child's environment (process memory).
 *
 * Exits with the child's exit status so the caller can react to the
 * underlying command's outcome unchanged.
 */
export function runWithSecrets(opts: RunOptions): number {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of opts.names) {
    const path = secretPath(
      opts.ctx.namespace.id,
      name,
      opts.ctx.home,
      opts.ctx.xdgConfigHome,
    );
    if (!existsSync(path)) {
      process.stderr.write(
        `secret not found: ${name} (ns=${opts.ctx.namespace.id})\n`,
      );
      return EXIT_ERROR;
    }
    const blob = readFileSync(path, 'utf8');
    try {
      env[name] = aesGcmDecrypt(
        opts.ctx.vmk,
        blob,
        aadFor(opts.ctx.namespace, name),
      );
    } catch (e) {
      process.stderr.write(
        `failed to decrypt ${name}: ${(e as Error).message}\n`,
      );
      return EXIT_ERROR;
    }
  }
  const result = spawnSync(opts.cmd, opts.cmdArgs, {
    stdio: 'inherit',
    env,
  });
  if (result.error) {
    process.stderr.write(`exec failed: ${result.error.message}\n`);
    return EXIT_ERROR;
  }
  if (typeof result.signal === 'string' && result.signal) {
    process.stderr.write(`child terminated by ${result.signal}\n`);
    return EXIT_ERROR;
  }
  return result.status ?? EXIT_OK;
}

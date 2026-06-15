import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { aesGcmDecrypt } from '../crypto.js';
import { aadFor, type Context } from '../context.js';
import { secretPath, tmpDir, write600 } from '../store.js';
import { EXIT_ERROR, EXIT_OK } from '../exit-codes.js';

export interface GetOptions {
  name: string;
  ctx: Context;
}

/**
 * Last-resort delivery path: decrypt the secret, write it to a
 * mode-0600 temp file under `<ns>/.tmp/<NAME>.<ts>.<pid>`, and print
 * the path on stdout. The caller is expected to read the file and
 * delete it.
 *
 * `run` is preferred because it leaves no readable artifact. Use this
 * only when the consumer cannot read from an env variable (e.g. it
 * insists on a credentials file).
 *
 * The janitor sweeps abandoned files older than 5 minutes on every
 * subsequent CLI invocation, so even if a caller forgets to delete
 * the file it doesn't linger.
 */
export function getSecret(opts: GetOptions): number {
  const path = secretPath(
    opts.ctx.namespace.id,
    opts.name,
    opts.ctx.home,
    opts.ctx.xdgConfigHome,
  );
  if (!existsSync(path)) {
    process.stderr.write(
      `secret not found: ${opts.name} (ns=${opts.ctx.namespace.id})\n`,
    );
    return EXIT_ERROR;
  }
  const blob = readFileSync(path, 'utf8');
  let plaintext: string;
  try {
    plaintext = aesGcmDecrypt(
      opts.ctx.vmk,
      blob,
      aadFor(opts.ctx.namespace, opts.name),
    );
  } catch (e) {
    process.stderr.write(
      `failed to decrypt ${opts.name}: ${(e as Error).message}\n`,
    );
    return EXIT_ERROR;
  }
  const outDir = tmpDir(
    opts.ctx.namespace.id,
    opts.ctx.home,
    opts.ctx.xdgConfigHome,
  );
  const outPath = join(outDir, `${opts.name}.${Date.now()}.${process.pid}`);
  write600(outPath, plaintext);
  process.stdout.write(outPath + '\n');
  return EXIT_OK;
}

import { aesGcmEncrypt } from '../crypto.js';
import { aadFor, type Context } from '../context.js';
import { write600, secretPath, lockDir } from '../store.js';
import { withLock, LockBusyError } from '../lock.js';
import { promptForSecret } from '../dialog.js';
import { EXIT_CANCELED, EXIT_ERROR, EXIT_OK } from '../exit-codes.js';
import { join } from 'node:path';

export interface SetOptions {
  name: string;
  why: string;
  ctx: Context;
}

/**
 * Shared implementation for both `set` and `request`. Differs only in
 * the default `why` text and intent. Holds a per-name lock to prevent
 * concurrent duplicate dialogs.
 */
export async function setSecret(opts: SetOptions): Promise<number> {
  const { name, why, ctx } = opts;
  const lockPath = join(
    lockDir(ctx.namespace.id, ctx.home, ctx.xdgConfigHome),
    `${name}.lock`,
  );
  try {
    return await withLock(lockPath, async () => {
      const value = await promptForSecret({ name, why });
      if (value === null) {
        process.stderr.write('cancelled by user\n');
        return EXIT_CANCELED;
      }
      const blob = aesGcmEncrypt(ctx.vmk, value, aadFor(ctx.namespace, name));
      const path = secretPath(
        ctx.namespace.id,
        name,
        ctx.home,
        ctx.xdgConfigHome,
      );
      write600(path, blob);
      process.stderr.write(`stored ${name} (ns=${ctx.namespace.id})\n`);
      return EXIT_OK;
    });
  } catch (e) {
    if (e instanceof LockBusyError) {
      process.stderr.write(`${e.message}\n`);
      return EXIT_ERROR;
    }
    process.stderr.write(`error: ${(e as Error).message}\n`);
    return EXIT_ERROR;
  }
}

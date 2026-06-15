import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export const DEFAULT_SERVICE = 'secret-broker-vmk';

export type SecurityRun = (args: string[]) => {
  status: number;
  stdout: string;
};

const defaultRun: SecurityRun = (args) => {
  try {
    return {
      status: 0,
      stdout: execFileSync('security', args, { encoding: 'utf8' }),
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: { toString?: () => string } };
    return {
      status: typeof err?.status === 'number' ? err.status : 1,
      stdout: err?.stdout?.toString?.() ?? '',
    };
  }
};

export interface KeychainConfig {
  account: string;
  service?: string;
  run?: SecurityRun;
}

/**
 * Get or create the Vault Master Key (VMK) from the OS Keychain.
 *
 * Behaviour:
 *  - If a 32-byte item exists at (service, account), return it.
 *  - If no item exists OR the stored item is the wrong length, generate
 *    a fresh 32-byte VMK and persist it (overwriting any malformed one).
 *  - If persistence fails, throw — never fall back to plaintext.
 *
 * The CLI is the only process that should ever touch the VMK. Agents
 * should never call this directly; they go through the CLI commands.
 */
export function getOrCreateVaultMasterKey(config: KeychainConfig): Buffer {
  const service = config.service ?? DEFAULT_SERVICE;
  const account = config.account;
  const run = config.run ?? defaultRun;

  const found = run(['find-generic-password', '-s', service, '-a', account, '-w']);
  if (found.status === 0) {
    const trimmed = found.stdout.trim();
    if (trimmed) {
      const existing = Buffer.from(trimmed, 'base64');
      if (existing.length === 32) return existing;
    }
  }

  const fresh = randomBytes(32);
  const added = run([
    'add-generic-password',
    '-U',
    '-s',
    service,
    '-a',
    account,
    '-w',
    fresh.toString('base64'),
  ]);
  if (added.status !== 0) {
    throw new Error(
      `Keychain: could not store VMK (fail-closed). ` +
        `security exited ${added.status}: ${added.stdout.trim()}`,
    );
  }
  return fresh;
}

import { homedir, userInfo } from 'node:os';
import { resolveNamespace, type Namespace } from './namespace.js';
import {
  getOrCreateVaultMasterKey,
  type KeychainConfig,
} from './keychain.js';
import { sweepStaleTmp } from './janitor.js';
import { tmpDir, dataDir } from './store.js';

const TMP_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export interface Context {
  vmk: Buffer;
  namespace: Namespace;
  home: string;
  xdgConfigHome: string | undefined;
  account: string;
}

export interface ContextOptions {
  cwd?: string;
  keychainConfig?: Partial<KeychainConfig>;
  janitor?: boolean;
}

/**
 * Bootstrap CLI context: resolve namespace, fetch VMK, run the janitor.
 *
 * Janitor runs on every CLI invocation (best-effort) to keep `get`
 * artifacts from accumulating. It only removes files matching the
 * `<NAME>.<ts>.<pid>` pattern older than 5 minutes — see janitor.ts.
 */
export function bootstrap(opts: ContextOptions = {}): Context {
  const cwd = opts.cwd ?? process.cwd();
  const home = homedir();
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const account = userInfo().username;

  const namespace = resolveNamespace(cwd);
  const vmk = getOrCreateVaultMasterKey({
    account,
    ...opts.keychainConfig,
  });

  if (opts.janitor !== false) {
    try {
      sweepStaleTmp(tmpDir(namespace.id, home, xdgConfigHome), TMP_MAX_AGE_MS);
    } catch {
      // Janitor is best-effort and must never block real commands.
    }
  }

  return { vmk, namespace, home, xdgConfigHome, account };
}

export function aadFor(namespace: Namespace, name: string): string {
  return `${namespace.id}:${name}:v2`;
}

export function rootDir(ctx: Context): string {
  return dataDir(ctx.home, ctx.xdgConfigHome);
}

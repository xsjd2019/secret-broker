import {
  mkdirSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const APP_DIR_NAME = 'secret-broker';

/**
 * Root data directory for the broker.
 *  - Respects XDG_CONFIG_HOME if provided.
 *  - Otherwise uses {home}/.config/{APP_DIR_NAME}.
 */
export function dataDir(home: string, xdgConfigHome?: string | undefined): string {
  const base = xdgConfigHome && xdgConfigHome.length > 0
    ? xdgConfigHome
    : join(home, '.config');
  return join(base, APP_DIR_NAME);
}

export function namespaceDir(
  ns: string,
  home: string,
  xdgConfigHome?: string | undefined,
): string {
  return join(dataDir(home, xdgConfigHome), ns);
}

export function secretPath(
  ns: string,
  name: string,
  home: string,
  xdgConfigHome?: string | undefined,
): string {
  return join(namespaceDir(ns, home, xdgConfigHome), name);
}

export function tmpDir(
  ns: string,
  home: string,
  xdgConfigHome?: string | undefined,
): string {
  return join(namespaceDir(ns, home, xdgConfigHome), '.tmp');
}

export function lockDir(
  ns: string,
  home: string,
  xdgConfigHome?: string | undefined,
): string {
  return join(namespaceDir(ns, home, xdgConfigHome), '.locks');
}

/**
 * Write a file with mode 0600. Creates parent directories.
 *
 * writeFileSync's `mode` option only takes effect when the file is
 * created — it is silently ignored when overwriting an existing file.
 * So we always chmod after write to guarantee the permission bits.
 */
export function write600(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

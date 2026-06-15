import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';

export interface Namespace {
  /** Hex sha256 prefix (16 chars) of the resolved path. */
  id: string;
  /** Where the namespace came from. */
  source: 'git' | 'cwd';
  /** The absolute, realpath-resolved directory that defined the namespace. */
  path: string;
}

export function namespaceFromPath(absPath: string): string {
  return createHash('sha256')
    .update(absPath)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Resolve the namespace for a working directory.
 *
 *  - If inside a git repository, use the repo's top-level directory.
 *  - Otherwise fall back to the cwd itself.
 *
 * Sub-paths of the same repo (or the same cwd) collapse to one
 * namespace, so secrets are scoped per project rather than per
 * directory.
 */
export function resolveNamespace(cwd: string): Namespace {
  try {
    const stdout = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const root = stdout.trim();
    if (root) {
      const path = safeRealpath(root);
      return { id: namespaceFromPath(path), source: 'git', path };
    }
  } catch {
    // not in a git repo or git not installed — fall through
  }
  const path = safeRealpath(cwd);
  return { id: namespaceFromPath(path), source: 'cwd', path };
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

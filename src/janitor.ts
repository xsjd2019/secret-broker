import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Filename pattern emitted by `secret get`:  <NAME>.<unixMs>.<pid>
 *  - NAME: secret name (alphanumeric / underscore / dash)
 *  - unixMs: 13-digit millisecond timestamp
 *  - pid:   integer process id
 *
 * We only delete files matching this pattern to guard against
 * accidentally wiping unrelated user data that happens to live in the
 * tmp dir.
 */
const TMP_PATTERN = /^[A-Za-z0-9_.-]+\.\d{10,16}\.\d+$/;

/**
 * Sweep a directory for `secret get` artifacts older than `maxAgeMs`.
 *
 * Returns the number of files deleted. Missing directories are not an
 * error (return 0). Files whose name does not match TMP_PATTERN are
 * always left alone.
 */
export function sweepStaleTmp(dir: string, maxAgeMs: number): number {
  if (!existsSync(dir)) return 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }

  const cutoff = Date.now() - maxAgeMs;
  let deleted = 0;
  for (const name of entries) {
    if (!TMP_PATTERN.test(name)) continue;
    const full = join(dir, name);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < cutoff) {
      try {
        unlinkSync(full);
        deleted++;
      } catch {
        // best-effort sweep
      }
    }
  }
  return deleted;
}

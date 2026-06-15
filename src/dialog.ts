import { execFile } from 'node:child_process';

export type DialogRunner = (args: string[]) => Promise<{
  status: number;
  stdout: string;
  stderr: string;
}>;

const defaultRunner: DialogRunner = (args) =>
  new Promise((resolve) => {
    execFile('osascript', args, (err, stdout, stderr) => {
      const status =
        err && typeof (err as { code?: number }).code === 'number'
          ? (err as { code: number }).code
          : err
            ? 1
            : 0;
      resolve({
        status,
        stdout: (stdout ?? '').toString(),
        stderr: (stderr ?? '').toString(),
      });
    });
  });

/**
 * Escape a string for safe embedding inside an AppleScript double-quoted
 * literal. Order matters: escape backslashes BEFORE quotes, otherwise a
 * backslash we add in front of " would itself be re-escaped.
 */
export function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export interface PromptOptions {
  name: string;
  why: string;
  title?: string;
  runner?: DialogRunner;
}

/**
 * Show a hidden-input dialog on the owner's GUI session asking for a
 * single secret value.
 *
 *  - Returns the entered string on OK.
 *  - Returns `null` on user cancellation (osascript -128).
 *  - Throws on any other osascript failure.
 *
 * Implementation: invokes `osascript` with a multi-line `-e` script.
 * The dialog title and prompt text are AppleScript-escaped to survive
 * arbitrary `--why` strings without breaking the script.
 */
export async function promptForSecret(
  opts: PromptOptions,
): Promise<string | null> {
  const runner = opts.runner ?? defaultRunner;
  const title = opts.title ?? 'secret';
  const message = `${opts.name} が必要です\n用途: ${opts.why}`;
  const script =
    `display dialog "${escapeAppleScript(message)}" ` +
    `default answer "" ` +
    `with hidden answer ` +
    `with title "${escapeAppleScript(title)}"`;
  const args = ['-e', script, '-e', 'text returned of result'];
  const res = await runner(args);
  if (res.status === 0) {
    // osascript appends a newline to stdout — trim only trailing newlines,
    // not internal whitespace (some tokens legitimately start/end with
    // spaces, though rare).
    return res.stdout.replace(/\r?\n$/, '');
  }
  // User canceled is represented as -128 in AppleScript. The CLI maps
  // that to exit status 1 and "User canceled" in stderr.
  if (/User canceled/i.test(res.stderr) || /\(-128\)/.test(res.stderr)) {
    return null;
  }
  throw new Error(
    `osascript failed (status ${res.status}): ${res.stderr.trim() || res.stdout.trim()}`,
  );
}

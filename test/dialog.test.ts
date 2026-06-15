import { describe, test, expect, vi } from 'vitest';
import { promptForSecret, escapeAppleScript } from '../src/dialog.js';

describe('escapeAppleScript', () => {
  test('escapes double quotes', () => {
    expect(escapeAppleScript('say "hi"')).toBe('say \\"hi\\"');
  });

  test('escapes backslashes', () => {
    expect(escapeAppleScript('a\\b')).toBe('a\\\\b');
  });

  test('escapes backslash BEFORE quotes (order matters)', () => {
    // If we escaped quotes first, then escaped backslashes, the backslash
    // we just inserted in front of " would itself get escaped, producing
    // \\" instead of \". So backslash must come first.
    expect(escapeAppleScript('"')).toBe('\\"');
    expect(escapeAppleScript('\\')).toBe('\\\\');
  });

  test('newlines stay literal (AppleScript handles \\n in default answer)', () => {
    expect(escapeAppleScript('a\nb')).toBe('a\nb');
  });
});

describe('promptForSecret', () => {
  test('returns text from osascript on success', async () => {
    const runner = vi.fn().mockResolvedValue({
      status: 0,
      stdout: 'sk-the-secret\n',
      stderr: '',
    });
    const val = await promptForSecret({
      name: 'CF_TOKEN',
      why: 'deploy',
      runner,
    });
    expect(val).toBe('sk-the-secret');
  });

  test('returns null on user cancellation (osascript exit 1, stderr "User canceled")', async () => {
    const runner = vi.fn().mockResolvedValue({
      status: 1,
      stdout: '',
      stderr: 'execution error: User canceled. (-128)',
    });
    const val = await promptForSecret({
      name: 'CF_TOKEN',
      why: 'deploy',
      runner,
    });
    expect(val).toBeNull();
  });

  test('throws on osascript failures that are not user-cancel', async () => {
    const runner = vi.fn().mockResolvedValue({
      status: 1,
      stdout: '',
      stderr: 'some other error',
    });
    await expect(
      promptForSecret({ name: 'X', why: 'y', runner }),
    ).rejects.toThrow();
  });

  test('embeds NAME and WHY into the prompt text (escaped)', async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ status: 0, stdout: 'v', stderr: '' });
    await promptForSecret({
      name: 'TOKEN',
      why: 'doc said "be careful"',
      runner,
    });
    const args = runner.mock.calls[0][0] as string[];
    const joined = args.join(' ');
    expect(joined).toContain('TOKEN');
    // The dialog text should contain the escaped form of the why string,
    // not the raw form (which would break AppleScript syntax).
    expect(joined).toContain('be careful');
    expect(joined).not.toContain('doc said "be careful"');
  });
});

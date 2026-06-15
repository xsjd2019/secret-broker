import { describe, test, expect } from 'vitest';
import { parseEnvFile } from '../src/commands/import-env.js';

describe('parseEnvFile', () => {
  test('parses simple KEY=VALUE', () => {
    expect(parseEnvFile('FOO=bar')).toEqual({ FOO: 'bar' });
  });

  test('handles export prefix', () => {
    expect(parseEnvFile('export FOO=bar')).toEqual({ FOO: 'bar' });
  });

  test('strips double quotes', () => {
    expect(parseEnvFile('FOO="bar baz"')).toEqual({ FOO: 'bar baz' });
  });

  test('strips single quotes', () => {
    expect(parseEnvFile("FOO='bar'")).toEqual({ FOO: 'bar' });
  });

  test('skips blank lines and comments', () => {
    const input = `
# this is a comment
FOO=1

BAR=2
# another
`;
    expect(parseEnvFile(input)).toEqual({ FOO: '1', BAR: '2' });
  });

  test('rejects invalid keys', () => {
    expect(parseEnvFile('1FOO=x')).toEqual({});
    expect(parseEnvFile('FOO-BAR=x')).toEqual({});
    expect(parseEnvFile('=x')).toEqual({});
  });

  test('preserves equals signs in value', () => {
    expect(parseEnvFile('TOKEN=abc=def=ghi')).toEqual({ TOKEN: 'abc=def=ghi' });
  });

  test('does NOT expand $VAR (kept literal — fix your .env, not ours)', () => {
    expect(parseEnvFile('FOO=$BAR')).toEqual({ FOO: '$BAR' });
  });
});

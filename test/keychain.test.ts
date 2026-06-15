import { describe, test, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  getOrCreateVaultMasterKey,
  DEFAULT_SERVICE,
  type SecurityRun,
} from '../src/keychain.js';

function mockRun(handlers: {
  find?: (args: string[]) => { status: number; stdout: string };
  add?: (args: string[]) => { status: number; stdout: string };
}): SecurityRun {
  return vi.fn((args: string[]) => {
    if (args[0] === 'find-generic-password') {
      return handlers.find ? handlers.find(args) : { status: 1, stdout: '' };
    }
    if (args[0] === 'add-generic-password') {
      return handlers.add ? handlers.add(args) : { status: 0, stdout: '' };
    }
    return { status: 1, stdout: '' };
  });
}

describe('getOrCreateVaultMasterKey', () => {
  test('returns a 32-byte Buffer', () => {
    const run = mockRun({ find: () => ({ status: 1, stdout: '' }) });
    const key = getOrCreateVaultMasterKey({ account: 'alice', run });
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  test('returns existing VMK when Keychain has a valid 32-byte item', () => {
    const existing = randomBytes(32);
    const run = mockRun({
      find: () => ({ status: 0, stdout: existing.toString('base64') + '\n' }),
    });
    const key = getOrCreateVaultMasterKey({ account: 'alice', run });
    expect(key.equals(existing)).toBe(true);
  });

  test('generates and persists a new VMK when Keychain is empty', () => {
    let storedSecret: string | undefined;
    const run = mockRun({
      find: () => ({ status: 1, stdout: '' }),
      add: (args) => {
        const wIdx = args.indexOf('-w');
        if (wIdx >= 0) storedSecret = args[wIdx + 1];
        return { status: 0, stdout: '' };
      },
    });
    const key = getOrCreateVaultMasterKey({ account: 'alice', run });
    expect(storedSecret).toBeDefined();
    expect(Buffer.from(storedSecret!, 'base64').equals(key)).toBe(true);
  });

  test('fail-closed: throws when add-generic-password fails', () => {
    const run = mockRun({
      find: () => ({ status: 1, stdout: '' }),
      add: () => ({ status: 1, stdout: 'permission denied' }),
    });
    expect(() =>
      getOrCreateVaultMasterKey({ account: 'alice', run }),
    ).toThrow(/Keychain/);
  });

  test('regenerates when stored key has wrong length', () => {
    let addCalled = false;
    const run = mockRun({
      // Return a 16-byte (wrong) key
      find: () => ({
        status: 0,
        stdout: randomBytes(16).toString('base64') + '\n',
      }),
      add: () => {
        addCalled = true;
        return { status: 0, stdout: '' };
      },
    });
    const key = getOrCreateVaultMasterKey({ account: 'alice', run });
    expect(key.length).toBe(32);
    expect(addCalled).toBe(true);
  });

  test('uses configurable service name', () => {
    const run = mockRun({ find: () => ({ status: 1, stdout: '' }) });
    getOrCreateVaultMasterKey({
      account: 'alice',
      service: 'my-custom-service',
      run,
    });
    const findCall = (run as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0][0] === 'find-generic-password',
    );
    expect(findCall![0]).toContain('my-custom-service');
  });

  test('uses default service name when not specified', () => {
    const run = mockRun({ find: () => ({ status: 1, stdout: '' }) });
    getOrCreateVaultMasterKey({ account: 'alice', run });
    const findCall = (run as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0][0] === 'find-generic-password',
    );
    expect(findCall![0]).toContain(DEFAULT_SERVICE);
  });

  test('passes the account argument', () => {
    const run = mockRun({ find: () => ({ status: 1, stdout: '' }) });
    getOrCreateVaultMasterKey({ account: 'bob', run });
    const findCall = (run as ReturnType<typeof vi.fn>).mock.calls.find(
      (call) => call[0][0] === 'find-generic-password',
    );
    expect(findCall![0]).toContain('bob');
  });
});

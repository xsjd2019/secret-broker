import { describe, test, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  aesGcmEncrypt,
  aesGcmDecrypt,
  vmkFingerprint,
  detectFormat,
} from '../src/crypto.js';

const vmk = () => randomBytes(32);
const aad = (ns: string, name: string) => `${ns}:${name}:v2`;

describe('vmkFingerprint', () => {
  test('returns first 4 bytes of sha256(key)', () => {
    const key = vmk();
    const fp = vmkFingerprint(key);
    expect(fp.length).toBe(4);
  });

  test('is deterministic', () => {
    const key = vmk();
    expect(vmkFingerprint(key).equals(vmkFingerprint(key))).toBe(true);
  });

  test('differs for different keys', () => {
    expect(vmkFingerprint(vmk()).equals(vmkFingerprint(vmk()))).toBe(false);
  });
});

describe('aesGcmEncrypt / aesGcmDecrypt (v2 round-trip)', () => {
  test('encrypt then decrypt returns plaintext', () => {
    const key = vmk();
    const plaintext = 'sk-test-1234567890';
    const blob = aesGcmEncrypt(key, plaintext, aad('proj-a', 'CF_TOKEN'));
    const out = aesGcmDecrypt(key, blob, aad('proj-a', 'CF_TOKEN'));
    expect(out).toBe(plaintext);
  });

  test('encrypts to v2 format', () => {
    const blob = aesGcmEncrypt(vmk(), 'x', aad('n', 'k'));
    expect(blob.startsWith('v2:')).toBe(true);
  });

  test('round-trip preserves empty string', () => {
    const key = vmk();
    const blob = aesGcmEncrypt(key, '', aad('n', 'k'));
    expect(aesGcmDecrypt(key, blob, aad('n', 'k'))).toBe('');
  });

  test('round-trip preserves multibyte/unicode', () => {
    const key = vmk();
    const plaintext = '日本語🔐 emoji + zwj 👨‍👩‍👧';
    const blob = aesGcmEncrypt(key, plaintext, aad('n', 'k'));
    expect(aesGcmDecrypt(key, blob, aad('n', 'k'))).toBe(plaintext);
  });

  test('IV is fresh: same plaintext encrypts to different blobs', () => {
    const key = vmk();
    const a = aesGcmEncrypt(key, 'same', aad('n', 'k'));
    const b = aesGcmEncrypt(key, 'same', aad('n', 'k'));
    expect(a).not.toBe(b);
  });
});

describe('aesGcmDecrypt (v2 security properties)', () => {
  test('throws on AAD mismatch (relocation attack)', () => {
    const key = vmk();
    const blob = aesGcmEncrypt(key, 'secret', aad('proj-a', 'CF_TOKEN'));
    expect(() =>
      aesGcmDecrypt(key, blob, aad('proj-a', 'LINE_TOKEN')),
    ).toThrow();
  });

  test('throws on namespace mismatch (cross-project relocation)', () => {
    const key = vmk();
    const blob = aesGcmEncrypt(key, 'secret', aad('proj-a', 'CF_TOKEN'));
    expect(() =>
      aesGcmDecrypt(key, blob, aad('proj-b', 'CF_TOKEN')),
    ).toThrow();
  });

  test('throws clear error on wrong VMK (fingerprint mismatch)', () => {
    const k1 = vmk();
    const k2 = vmk();
    const blob = aesGcmEncrypt(k1, 'secret', aad('n', 'k'));
    expect(() => aesGcmDecrypt(k2, blob, aad('n', 'k'))).toThrow(
      /VMK fingerprint/,
    );
  });

  test('throws on tampered ciphertext', () => {
    const key = vmk();
    const blob = aesGcmEncrypt(key, 'secret', aad('n', 'k'));
    // Flip one byte in the ciphertext payload (after "v2:" prefix)
    const buf = Buffer.from(blob.slice(3), 'base64');
    const idx = buf.length - 20; // somewhere in the ciphertext
    buf[idx] = buf[idx]! ^ 0x01;
    const tampered = 'v2:' + buf.toString('base64');
    expect(() => aesGcmDecrypt(key, tampered, aad('n', 'k'))).toThrow();
  });
});

describe('aesGcmDecrypt (v1 backward compatibility)', () => {
  // We don't have a v1 producer (intentionally — v1 is read-only),
  // but the format is documented. Construct a v1 blob by hand.
  function makeV1(key: Buffer, plaintext: string): string {
    const { createCipheriv, randomBytes } = require('node:crypto');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'v1:' + Buffer.concat([iv, ct, tag]).toString('base64');
  }

  test('decrypts a v1 blob (AAD ignored)', () => {
    const key = vmk();
    const blob = makeV1(key, 'legacy-secret');
    // Pass any AAD; v1 should ignore it
    expect(aesGcmDecrypt(key, blob, 'anything')).toBe('legacy-secret');
  });
});

describe('detectFormat', () => {
  test('detects v1', () => {
    expect(detectFormat('v1:abc')).toBe('v1');
  });

  test('detects v2', () => {
    expect(detectFormat('v2:abc')).toBe('v2');
  });

  test('throws on unknown format', () => {
    expect(() => detectFormat('plaintext')).toThrow();
    expect(() => detectFormat('v3:future')).toThrow();
  });
});

describe('aesGcmDecrypt (input validation)', () => {
  test('throws on unknown prefix', () => {
    expect(() => aesGcmDecrypt(vmk(), 'plaintext', 'aad')).toThrow();
  });
});

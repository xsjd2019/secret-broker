import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from 'node:crypto';

const V1_PREFIX = 'v1:';
const V2_PREFIX = 'v2:';
const IV_LEN = 12;
const TAG_LEN = 16;
const FP_LEN = 4;

/**
 * Return the first 4 bytes of sha256(key) as the VMK fingerprint.
 * Embedded in v2 ciphertext so that decrypting with a different VMK
 * fails fast with a clear error (instead of a generic auth tag mismatch).
 */
export function vmkFingerprint(key: Buffer): Buffer {
  return createHash('sha256').update(key).digest().subarray(0, FP_LEN);
}

export function detectFormat(blob: string): 'v1' | 'v2' {
  if (blob.startsWith(V1_PREFIX)) return 'v1';
  if (blob.startsWith(V2_PREFIX)) return 'v2';
  throw new Error('unknown at-rest format (expected v1: or v2: prefix)');
}

/**
 * Encrypt plaintext with AES-256-GCM. Always produces v2 format.
 *
 * Format: "v2:" + base64( fp(4) || iv(12) || ciphertext || tag(16) )
 *
 * AAD binds the ciphertext to a context string (typically
 * `${namespace}:${name}:v2`) so that a blob can't be silently relocated
 * to a different name/namespace.
 */
export function aesGcmEncrypt(
  key: Buffer,
  plaintext: string,
  aad: string,
): string {
  if (key.length !== 32) throw new Error('VMK must be 32 bytes');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const fp = vmkFingerprint(key);
  return V2_PREFIX + Buffer.concat([fp, iv, ct, tag]).toString('base64');
}

/**
 * Decrypt a v1 or v2 at-rest blob. AAD is only checked for v2.
 *
 * Errors:
 *  - "VMK fingerprint mismatch" — wrong VMK (key rotated / regenerated).
 *  - "unknown at-rest format"   — corrupted or non-broker blob.
 *  - auth tag failure           — tampered ciphertext or wrong AAD.
 */
export function aesGcmDecrypt(
  key: Buffer,
  blob: string,
  aad: string,
): string {
  const format = detectFormat(blob);
  if (format === 'v1') {
    return decryptV1(key, blob);
  }
  return decryptV2(key, blob, aad);
}

function decryptV1(key: Buffer, blob: string): string {
  const buf = Buffer.from(blob.slice(V1_PREFIX.length), 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('v1 blob too short');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function decryptV2(key: Buffer, blob: string, aad: string): string {
  const buf = Buffer.from(blob.slice(V2_PREFIX.length), 'base64');
  if (buf.length < FP_LEN + IV_LEN + TAG_LEN) {
    throw new Error('v2 blob too short');
  }
  const fp = buf.subarray(0, FP_LEN);
  if (!fp.equals(vmkFingerprint(key))) {
    throw new Error(
      'VMK fingerprint mismatch (the master key has changed — these secrets cannot be decrypted)',
    );
  }
  const iv = buf.subarray(FP_LEN, FP_LEN + IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(FP_LEN + IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

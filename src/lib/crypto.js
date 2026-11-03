const crypto = require('crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 'v1';

function deriveKey() {
  const raw = Buffer.from(config.sessionEncryptionKey, 'hex');
  if (raw.length !== 32) {
    throw new Error(
      'SESSION_ENC_KEY must be a 32-byte value encoded as 64 hex characters. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return raw;
}

const key = deriveKey();

function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, authTag, ciphertext]).toString('base64')}`;
}

function decrypt(blob) {
  if (typeof blob !== 'string' || blob.length === 0) {
    throw new Error('Cannot decrypt an empty token');
  }

  // `v1.` was added later; older records are plain base64 and still decrypt.
  const encoded = blob.startsWith(`${VERSION}.`) ? blob.slice(VERSION.length + 1) : blob;
  const buffer = Buffer.from(encoded, 'base64');

  if (buffer.length <= IV_LENGTH + TAG_LENGTH) {
    throw new Error('Encrypted token is truncated');
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function randomId(bytes = 32) {
  if (!Number.isInteger(bytes) || bytes < 1) {
    throw new Error('randomId requires a positive integer');
  }
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { encrypt, decrypt, randomId };

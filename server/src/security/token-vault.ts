import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedSecret = {
  version: 1;
  iv: string;
  authTag: string;
  ciphertext: string;
};

export type TokenVault = {
  encrypt(plaintext: string, purpose: string): EncryptedSecret;
  decrypt(envelope: EncryptedSecret, purpose: string): string;
};

export function createTokenVault(key: Buffer): TokenVault {
  if (key.length !== 32) {
    throw new Error('Token vault requires a 32-byte AES-256 key.');
  }

  return {
    encrypt(plaintext, purpose) {
      if (!plaintext) throw new Error('Cannot encrypt an empty secret.');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(purpose, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return {
        version: 1,
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64')
      };
    },
    decrypt(envelope, purpose) {
      if (envelope.version !== 1) throw new Error('Unsupported encrypted secret version.');
      const iv = Buffer.from(envelope.iv, 'base64');
      const authTag = Buffer.from(envelope.authTag, 'base64');
      if (iv.length !== 12 || authTag.length !== 16) throw new Error('Invalid encrypted secret envelope.');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(purpose, 'utf8'));
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final()
      ]);
      return plaintext.toString('utf8');
    }
  };
}

export function decodeEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must decode to exactly 32 bytes.');
  return key;
}

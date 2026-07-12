import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedToken {
  authTag: Buffer;
  ciphertext: Buffer;
  iv: Buffer;
}

export function encryptToken(plaintext: string, masterKey: Buffer): EncryptedToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final()
  ]);

  return {
    authTag: cipher.getAuthTag(),
    ciphertext,
    iv
  };
}

export function decryptToken(record: EncryptedToken, masterKey: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", masterKey, record.iv);
  decipher.setAuthTag(record.authTag);
  const plaintext = Buffer.concat([
    decipher.update(record.ciphertext),
    decipher.final()
  ]);
  return plaintext.toString("utf-8");
}

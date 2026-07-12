import type { AppConfig } from "../config.js";
import { decryptToken, encryptToken } from "./crypto.js";
import { CredentialsRepository, type CredentialRecord } from "./repository.js";
import { verifyEdToken, type VerifiedEdIdentity } from "./verifier.js";

export class EdNotConnectedError extends Error {
  constructor() {
    super("Ed Discussion is not connected for this account.");
    this.name = "EdNotConnectedError";
  }
}

export class EdReconnectRequiredError extends Error {
  constructor() {
    super("Ed Discussion credentials expired or need to be refreshed.");
    this.name = "EdReconnectRequiredError";
  }
}

export interface ConnectionStatus {
  connected: boolean;
  edUserId?: number;
  edUserName?: string;
  isInvalid: boolean;
  lastVerifiedAt?: number;
}

export class CredentialsService {
  private readonly config: AppConfig;
  private readonly repository: CredentialsRepository;

  constructor(repository: CredentialsRepository, config: AppConfig) {
    this.repository = repository;
    this.config = config;
  }

  async connect(userId: number, token: string): Promise<CredentialRecord> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error("Ed API token is required.");
    }

    const verified = await verifyEdToken(trimmed, this.config.apiBaseUrl);
    return this.connectVerified(userId, trimmed, verified);
  }

  connectVerified(
    userId: number,
    token: string,
    verified: VerifiedEdIdentity
  ): CredentialRecord {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error("Ed API token is required.");
    }

    const encrypted = encryptToken(trimmed, this.config.masterKey);
    const lastVerifiedAt = Date.now();

    this.repository.upsert({
      authTag: encrypted.authTag,
      ciphertext: encrypted.ciphertext,
      edUserId: verified.edUserId,
      edUserName: verified.edUserName,
      iv: encrypted.iv,
      lastVerifiedAt,
      userId
    });

    return this.requireRecord(userId);
  }

  delete(userId: number): void {
    this.repository.delete(userId);
  }

  getConnectionStatus(userId: number): ConnectionStatus {
    const record = this.repository.getByUserId(userId);
    if (!record) {
      return {
        connected: false,
        isInvalid: false
      };
    }

    return {
      connected: true,
      edUserId: record.edUserId,
      edUserName: record.edUserName,
      isInvalid: record.isInvalid,
      lastVerifiedAt: record.lastVerifiedAt
    };
  }

  getDecryptedEdToken(userId: number): string {
    const record = this.repository.getByUserId(userId);
    if (!record) {
      throw new EdNotConnectedError();
    }
    if (record.isInvalid) {
      throw new EdReconnectRequiredError();
    }

    return this.decryptRecord(record);
  }

  markInvalid(userId: number): void {
    this.repository.markInvalid(userId);
  }

  private decryptRecord(record: CredentialRecord): string {
    try {
      return decryptToken(record, this.config.masterKey);
    } catch (error) {
      if (!this.config.masterKeyPrevious) {
        throw error;
      }

      const plaintext = decryptToken(record, this.config.masterKeyPrevious);
      const encrypted = encryptToken(plaintext, this.config.masterKey);
      this.repository.upsert({
        authTag: encrypted.authTag,
        ciphertext: encrypted.ciphertext,
        edUserId: record.edUserId,
        edUserName: record.edUserName,
        iv: encrypted.iv,
        lastVerifiedAt: record.lastVerifiedAt,
        userId: record.userId
      });
      return plaintext;
    }
  }

  private requireRecord(userId: number): CredentialRecord {
    const record = this.repository.getByUserId(userId);
    if (!record) {
      throw new EdNotConnectedError();
    }
    return record;
  }
}

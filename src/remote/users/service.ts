import type { VerifiedEdIdentity } from "../credentials/verifier.js";
import { UsersRepository, type UserRecord } from "./repository.js";

export class EdIdentityMismatchError extends Error {
  constructor() {
    super("This Ed API token belongs to a different Ed account.");
    this.name = "EdIdentityMismatchError";
  }
}

export class UsersService {
  private readonly repository: UsersRepository;

  constructor(repository: UsersRepository) {
    this.repository = repository;
  }

  findByEmail(email: string): UserRecord | null {
    return this.repository.getByEmail(normalizeEmail(email));
  }

  findByEdUserId(edUserId: number): UserRecord | null {
    return this.repository.getByEdUserId(edUserId);
  }

  getById(userId: number): UserRecord {
    const user = this.repository.getById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    return user;
  }

  upsertFromEdIdentity(identity: VerifiedEdIdentity): UserRecord {
    const now = Date.now();
    const normalized = normalizeEdIdentity(identity);

    const existing = this.repository.getByEdUserId(identity.edUserId);
    if (existing) {
      this.repository.updateIdentity(existing.id, {
        displayName: normalized.displayName,
        edUserId: identity.edUserId,
        email: normalized.email,
        lastLoginAt: now
      });
      return this.getById(existing.id);
    }

    const legacy = this.repository.getByEmail(normalized.email);
    if (legacy) {
      this.repository.updateIdentity(legacy.id, {
        displayName: normalized.displayName,
        edUserId: identity.edUserId,
        email: normalized.email,
        lastLoginAt: now
      });
      return this.getById(legacy.id);
    }

    return this.repository.create({
      createdAt: now,
      displayName: normalized.displayName,
      edUserId: identity.edUserId,
      email: normalized.email,
      lastLoginAt: now
    });
  }

  syncIdentity(userId: number, identity: VerifiedEdIdentity): UserRecord {
    const now = Date.now();
    const current = this.getById(userId);
    const existing = this.repository.getByEdUserId(identity.edUserId);
    if (existing && existing.id !== userId) {
      throw new EdIdentityMismatchError();
    }
    if (current.edUserId && current.edUserId !== identity.edUserId) {
      throw new EdIdentityMismatchError();
    }

    const normalized = normalizeEdIdentity(identity);
    this.repository.updateIdentity(userId, {
      displayName: normalized.displayName,
      edUserId: identity.edUserId,
      email: normalized.email,
      lastLoginAt: now
    });
    return this.getById(userId);
  }

  deleteAccount(userId: number): void {
    this.repository.delete(userId);
  }
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeEdIdentity(identity: VerifiedEdIdentity): {
  displayName: string;
  email: string;
} {
  const email = normalizeEmail(identity.edUserEmail) || syntheticEmail(identity.edUserId);
  return {
    displayName: normalizeDisplayName(identity.edUserName) || email,
    email
  };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function syntheticEmail(edUserId: number): string {
  return `ed-${edUserId}@local.invalid`;
}

/**
 * On-disk credential store for AgentDeck.
 *
 * Design constraints, in order of importance:
 *
 * 1. **One file per provider**, not one JSON blob. A single `secrets.json`
 *    holding every key is one `cat` away from total compromise and gets swept
 *    into any dotfile backup wholesale. Per-provider files also mean a
 *    corrupted write loses one credential, not all of them.
 * 2. **The secret never enters SQLite, the API, or a log.** Everything outside
 *    this module handles a `credentialRef` ("file:openrouter") instead.
 * 3. **0600 on the file, 0700 on the directory**, re-asserted on every write —
 *    `mkdir -p` leaves a pre-existing 0755 directory alone.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureSecureDirectory, writeSecureFile } from './index.js';

/** Prefix marking a reference resolvable by this store. */
const FILE_REF_PREFIX = 'file:';

/** Provider ids are used as filenames — keep them boring. */
const SAFE_PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface SecretStoreOptions {
  /** Directory holding the key files. Defaults to `~/.agentdeck/secrets`. */
  secretsDir: string;
}

export class SecretStore {
  private readonly dir: string;

  constructor(options: SecretStoreOptions) {
    this.dir = options.secretsDir;
  }

  /** Builds the reference that gets stored in SQLite and shipped to agents. */
  static refFor(providerId: string): string {
    return `${FILE_REF_PREFIX}${providerId}`;
  }

  /** Extracts a provider id from a reference, or null if it is not one of ours. */
  static providerFromRef(ref: string): string | null {
    if (!ref.startsWith(FILE_REF_PREFIX)) return null;
    const id = ref.slice(FILE_REF_PREFIX.length);
    return SAFE_PROVIDER_ID.test(id) ? id : null;
  }

  private pathFor(providerId: string): string {
    if (!SAFE_PROVIDER_ID.test(providerId)) {
      throw new Error(`invalid provider id for secret storage: ${providerId}`);
    }
    return path.join(this.dir, `${providerId}.key`);
  }

  /** Writes (or replaces) a credential. Returns the reference to store. */
  async set(providerId: string, secret: string): Promise<string> {
    const trimmed = secret.trim();
    if (!trimmed) throw new Error('refusing to store an empty credential');
    await ensureSecureDirectory(this.dir);
    // writeSecureFile chmods the parent to 0700, which is exactly right here
    // (and exactly wrong for agent config dirs — do not reuse it there).
    await writeSecureFile(this.pathFor(providerId), `${trimmed}\n`);
    return SecretStore.refFor(providerId);
  }

  /** Reads a credential, or null when it is not stored. */
  async get(providerId: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(this.pathFor(providerId), 'utf8');
      const value = raw.trim();
      return value || null;
    } catch {
      return null;
    }
  }

  /** Resolves a `file:` reference. Non-`file:` references resolve to null. */
  async resolve(ref: string): Promise<string | null> {
    const providerId = SecretStore.providerFromRef(ref);
    return providerId ? this.get(providerId) : null;
  }

  /** True when a credential is on disk. Safe to expose over the API. */
  async has(providerId: string): Promise<boolean> {
    return (await this.get(providerId)) !== null;
  }

  async delete(providerId: string): Promise<boolean> {
    try {
      await fs.unlink(this.pathFor(providerId));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Presence map for the UI — provider ids only, never values.
   * Returns `{ openrouter: true }`, never the key itself.
   */
  async status(): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.key')) continue;
      const providerId = entry.slice(0, -'.key'.length);
      if (SAFE_PROVIDER_ID.test(providerId)) {
        out[providerId] = await this.has(providerId);
      }
    }
    return out;
  }
}

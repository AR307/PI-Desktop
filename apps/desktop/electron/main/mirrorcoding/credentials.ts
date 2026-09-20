import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { MirrorCodingCatalog } from "@pi-desktop/shared";

export type Grant = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  authorizationExpiresAt: number;
  authorizationId: string;
  catalog?: MirrorCodingCatalog;
};
export type CredentialState = { active?: Grant; pendingRevocations: string[] };
export type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?: () => string;
};

/** The main process owns the encrypted grant and revoke-only records. */
export class MirrorCodingCredentials {
  private writes: Promise<void> = Promise.resolve();
  constructor(private path: string, private encryption: Encryption) {}

  assertAvailable(): void {
    if (!this.encryption.isEncryptionAvailable() ||
        this.encryption.getSelectedStorageBackend?.() === "basic_text") {
      throw new Error("secure_storage_unavailable");
    }
  }

  async load(): Promise<CredentialState> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { pendingRevocations: [] };
      throw new Error("credential_read_failed");
    }
    this.assertAvailable();
    try {
      const value: CredentialState = JSON.parse(this.encryption.decryptString(encrypted));
      if (!Array.isArray(value.pendingRevocations) ||
          value.pendingRevocations.some((token) => typeof token !== "string") ||
          (value.active && (typeof value.active.accessToken !== "string" ||
            typeof value.active.refreshToken !== "string" ||
            !Number.isFinite(value.active.authorizationExpiresAt)))) {
        throw new Error("invalid credential record");
      }
      return value;
    } catch {
      throw new Error("credential_read_failed");
    }
  }

  save(value: CredentialState): Promise<void> {
    this.assertAvailable();
    const encrypted = this.encryption.encryptString(JSON.stringify(value));
    const write = this.writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.next`, encrypted, { mode: 0o600 });
      await rename(`${this.path}.next`, this.path);
    }).catch(() => { throw new Error("credential_write_failed"); });
    this.writes = write.catch(() => {});
    return write;
  }
}

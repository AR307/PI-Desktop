import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type MobileDeviceCredentialsRecord = {
  accountId: string;
  deviceId: string;
  deviceSecret: string;
};

export type MobileDeviceEncryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?: () => string;
};

/** Keeps the MC installation secret in the Electron main process only. */
export class MobileDeviceCredentials {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly path: string, private readonly encryption: MobileDeviceEncryption) {}

  private assertAvailable(): void {
    if (!this.encryption.isEncryptionAvailable() ||
        this.encryption.getSelectedStorageBackend?.() === "basic_text") {
      throw new Error("secure_storage_unavailable");
    }
  }

  async load(accountId: string): Promise<MobileDeviceCredentialsRecord | undefined> {
    this.assertAvailable();
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("device_credential_read_failed");
    }
    try {
      const value = JSON.parse(this.encryption.decryptString(encrypted)) as Partial<MobileDeviceCredentialsRecord>;
      if (typeof value.accountId !== "string" || typeof value.deviceId !== "string" || typeof value.deviceSecret !== "string") {
        return undefined;
      }
      return value.accountId === accountId ? value as MobileDeviceCredentialsRecord : undefined;
    } catch {
      throw new Error("device_credential_read_failed");
    }
  }

  save(value: MobileDeviceCredentialsRecord): Promise<void> {
    this.assertAvailable();
    const encrypted = this.encryption.encryptString(JSON.stringify(value));
    const write = this.writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.next`, encrypted, { mode: 0o600 });
      await rename(`${this.path}.next`, this.path);
    }).catch(() => { throw new Error("device_credential_write_failed"); });
    this.writes = write.catch(() => undefined);
    return write;
  }

  /** Overwrite with an encrypted tombstone instead of leaving a plaintext secret behind. */
  clear(): Promise<void> {
    this.assertAvailable();
    const encrypted = this.encryption.encryptString("{}");
    const write = this.writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.next`, encrypted, { mode: 0o600 });
      await rename(`${this.path}.next`, this.path);
    }).catch(() => { throw new Error("device_credential_write_failed"); });
    this.writes = write.catch(() => undefined);
    return write;
  }
}

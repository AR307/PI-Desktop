import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

export interface CredentialStore {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

const credentialKey = "pi.mobile.account";

/** Web tests must explicitly supply their own store; account tokens never enter Web Storage. */
export function nativeCredentialStore(): CredentialStore {
  const requireNative = () => {
    if (!Capacitor.isNativePlatform()) throw new Error("secure_storage_unavailable");
  };
  return {
    async read() {
      requireNative();
      const value = await SecureStorage.get(credentialKey);
      return typeof value === "string" ? value : null;
    },
    async write(value) { requireNative(); await SecureStorage.set(credentialKey, value); },
    async clear() { requireNative(); await SecureStorage.remove(credentialKey); },
  };
}

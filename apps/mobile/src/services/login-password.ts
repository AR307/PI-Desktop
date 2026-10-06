type LoginKey = { enabled: boolean; encryptionKeyId?: string; publicKey?: string; algorithm?: string };

/** Encrypt only when requested by MC; a malformed key must not send plaintext. */
export async function loginPassword(password: string, key: LoginKey): Promise<Record<string, string>> {
  if (key.enabled === false) return { password };
  if (key.enabled !== true || key.algorithm !== "RSA-OAEP-256" || !key.encryptionKeyId || !key.publicKey) throw new Error("INVALID_ENCRYPTION_KEY");
  const encoded = key.publicKey.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, "");
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  const imported = await crypto.subtle.importKey("spki", bytes, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, imported, new TextEncoder().encode(password));
  return { encryptionKeyId: key.encryptionKeyId, passwordEncrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))) };
}

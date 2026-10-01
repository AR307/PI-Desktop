import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServer as createViteServer } from "vite";

const root = resolve(import.meta.dirname, "..");
const vite = await createViteServer({
  root,
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { MobileDeviceCredentials } = await vite.ssrLoadModule(
  "/electron/main/mobile-sync/device-credentials.ts",
);
after(() => vite.close());

function encryption() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(value), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(value) {
      const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([
        decipher.update(value.subarray(28)),
        decipher.final(),
      ]).toString();
    },
  };
}

test("mobile device identity is encrypted and account scoped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-mobile-device-"));
  const path = join(directory, "device.enc");
  const credentials = new MobileDeviceCredentials(path, encryption());
  assert.equal(await credentials.load("account-one"), undefined);
  await credentials.save({ accountId: "account-one", deviceId: "desktop-one", deviceSecret: "secret-one" });
  assert.deepEqual(await credentials.load("account-one"), {
    accountId: "account-one",
    deviceId: "desktop-one",
    deviceSecret: "secret-one",
  });
  assert.equal(await credentials.load("account-two"), undefined);
  assert.equal((await readFile(path)).includes(Buffer.from("secret-one")), false);
  await credentials.clear();
  assert.equal(await credentials.load("account-one"), undefined);
});

test("unavailable secure storage fails explicitly", async () => {
  const credentials = new MobileDeviceCredentials(
    join(await mkdtemp(join(tmpdir(), "pi-mobile-device-")), "device.enc"),
    { ...encryption(), isEncryptionAvailable: () => false },
  );
  assert.throws(
    () => credentials.save({ accountId: "a", deviceId: "d", deviceSecret: "s" }),
    /secure_storage_unavailable/,
  );
});

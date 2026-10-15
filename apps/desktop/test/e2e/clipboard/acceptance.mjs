import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { HostProcess } from "@pi-desktop/host-runtime";

const require = createRequire(import.meta.url);
const { _electron } = require(process.env.PI_TEST_PLAYWRIGHT ?? "playwright");
const root = resolve(import.meta.dirname, "../../../../..");
const output = resolve(process.env.PI_TEST_OUTPUT ?? join(root, ".artifacts", `clipboard-${Date.now()}`));
const binaryPath = process.env.PI_DESKTOP_HOST_BIN ?? join(root, "target/debug/pi-desktop-host-core.exe");
const passed = [];
let desktop;
await mkdir(output, { recursive: true });
const check = (label, value) => {
  assert(value, label);
  passed.push(label);
  console.log(`PASS ${label}`);
};
const revision = Object.fromEntries([
  ["candidate", ["rev-parse", "HEAD"]],
  ["base", ["rev-parse", "origin/main"]],
  ["workspace", ["status", "--short"]],
].map(([key, args]) => [key, execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()]));

try {
  const host = new HostProcess({ binaryPath, dataDir: join(output, "profile"), onStderr() {} });
  let session;
  try {
    await host.handshake();
    await host.call("settings.set", { language: "en", theme: "dark", developerMode: false, mirrorCodingWelcomeCompleted: true });
    ({ session } = await host.call("session.create", { title: "Clipboard copy acceptance", mode: "agent" }));
  } finally {
    await host.dispose();
  }

  const env = { ...process.env, PI_DESKTOP_DATA_DIR: join(output, "profile"), PI_DESKTOP_HOST_BIN: binaryPath };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  desktop = await _electron.launch({
    executablePath: require("electron"),
    args: [join(root, "apps/desktop"), `--user-data-dir=${join(output, "electron-profile")}`],
    env, timeout: 60_000,
  });
  const isMain = (candidate) => candidate.url().endsWith("/renderer/index.html");
  const page = desktop.windows().find(isMain) ?? await desktop.waitForEvent("window", { predicate: isMain, timeout: 60_000 });
  page.setDefaultTimeout(20_000);
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.locator(".startup-splash").waitFor({ state: "hidden" });
  await desktop.evaluate(({ clipboard, BrowserWindow }) => {
    globalThis.__clipboardBeforeTest = {
      text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage(),
    };
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.session.setPermissionCheckHandler(() => false);
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    }
  });
  check("browser clipboard writes are denied in the isolated renderer", await page.evaluate(async () => {
    try { await navigator.clipboard.writeText("Browser permission probe"); return false; } catch (error) { return error.name === "NotAllowedError"; }
  }));

  await page.locator(`[data-sidebar-session-row="${session.id}"]`).first().click({ button: "right" });
  await page.locator(`[data-action="copy-conversation-id"]`).waitFor();
  await page.screenshot({ path: join(output, "context-menu.png") });
  await page.locator(`[data-action="copy-conversation-id"]`).click();
  await page.locator(`[data-action="copy-conversation-id"]`).waitFor({ state: "hidden" });
  // Compare inside Electron so a failure never prints personal clipboard contents.
  check("context-menu copy writes the durable session ID despite denied browser permission", await desktop.evaluate(({ clipboard }, id) => clipboard.readText() === id, session.id));
  await page.getByText("Copied", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "copied.png") });

  for (const input of [{ text: 42 }, null]) {
    const result = await page.evaluate((payload) => window.piDesktop.invoke("pi-desktop/clipboard/writeText", payload), input);
    check("malformed clipboard IPC is rejected", !result.ok && result.error.code === "INVALID_ARGUMENT");
  }
  check("invalid writes leave the copied ID unchanged", await desktop.evaluate(({ clipboard }, id) => clipboard.readText() === id, session.id));

  const other = desktop.windows().find((candidate) => candidate.url().includes("surface=plugin-launcher"));
  assert(other, "isolated plugin-launcher renderer exists");
  const rejected = await other.evaluate(() => window.piDesktop.invoke("pi-desktop/clipboard/writeText", { text: "Unauthorized renderer" }));
  check("non-main renderer cannot use the clipboard IPC", !rejected.ok && rejected.error.code === "PERMISSION_DENIED");
  check("unauthorized writes leave the copied ID unchanged", await desktop.evaluate(({ clipboard }, id) => clipboard.readText() === id, session.id));

  const settings = await page.evaluate(() => window.piDesktop.invoke("pi-desktop/settings/get"));
  assert(settings.ok);
  const updated = await page.evaluate((value) => window.piDesktop.invoke("pi-desktop/settings/set", { ...value, language: "zh-CN", theme: "light" }), settings.data);
  assert(updated.ok);
  await page.reload();
  await page.locator(".app-shell:not(.app-shell-boot)").waitFor();
  await page.locator(".startup-splash").waitFor({ state: "hidden" });
  await page.locator(`[data-sidebar-session-row="${session.id}"]`).first().click({ button: "right" });
  await page.locator(`[data-action="copy-conversation-id"]`).click();
  await page.locator(`[data-action="copy-conversation-id"]`).waitFor({ state: "hidden" });
  check("copy works after renderer reload in Chinese light theme", await desktop.evaluate(({ clipboard }, id) => clipboard.readText() === id, session.id));
  await page.getByText("已复制", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "copied-light-zh.png") });
} finally {
  if (desktop) {
    await desktop.evaluate(({ clipboard }) => {
      if (globalThis.__clipboardBeforeTest) clipboard.write(globalThis.__clipboardBeforeTest);
      process.env.PI_DESKTOP_BOOT_PROBE = "1";
    });
    await desktop.close();
  }
  await writeFile(join(output, "result.json"), JSON.stringify({ ...revision, passed }, null, 2));
  console.log(`Evidence: ${output}`);
}

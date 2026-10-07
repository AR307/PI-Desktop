import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot, resolveElectronBinary } from "../../../scripts/e2e/boot.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");

const fixtureSource = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { JEV_API_KEY_SECRET_REF } from "@pi-desktop/shared";
import { JevSettingsCard } from "../../apps/desktop/src/components/settings/JevSettingsCard";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

const apiCalls = [];
let savedKey;
let savedSettings = {
  defaultMode: "agent",
  theme: "light",
  language: "en",
  developerMode: false,
  jevEnabled: false,
};
window.piDesktop = {
  platform: "darwin",
  on() { return () => {}; },
  async invoke(channel, ...args) {
    const input = args[0];
    apiCalls.push({ channel, input });
    switch (channel) {
      case "pi-desktop/secrets/has":
        return { ok: true, data: { has: typeof savedKey === "string" } };
      case "pi-desktop/secrets/set":
        if (input.secretRef !== JEV_API_KEY_SECRET_REF) throw new Error("unexpected secret ref");
        savedKey = input.value;
        return { ok: true, data: undefined };
      case "pi-desktop/secrets/delete":
        if (input !== JEV_API_KEY_SECRET_REF) throw new Error("unexpected secret ref");
        savedKey = undefined;
        return { ok: true, data: undefined };
      case "pi-desktop/settings/set":
        savedSettings = input;
        useAppStore.setState({ settings: savedSettings });
        return { ok: true, data: undefined };
      default:
        throw new Error("Unexpected fixture IPC: " + channel);
    }
  },
};

await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  keySeparator: false,
  resources: { en: { translation: flattenCatalog(catalogs.en) } },
  interpolation: { escapeValue: false },
});
useAppStore.setState({ settings: savedSettings });
function JevSettingsHarness() {
  const settings = useAppStore((state) => state.settings);
  return React.createElement(JevSettingsCard, { settings: settings ?? undefined });
}
const rootNode = createRoot(document.getElementById("root"));
flushSync(() => rootNode.render(React.createElement(JevSettingsHarness)));

const frame = () => new Promise(requestAnimationFrame);
async function settle() { await frame(); await frame(); }
async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await settle();
    const value = predicate();
    if (value) return value;
  }
  throw new Error(message);
}
function button(label) {
  return [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent.trim() === label);
}

window.jevSettingsProbe = async () => {
  await waitFor(() => document.body.innerText.includes("API key not configured"), "initial key state missing");
  const toggle = document.querySelector('[role="switch"][aria-label="Enable Jev for Agent"]');
  if (!toggle?.disabled) throw new Error("Jev must stay disabled until a key is saved");
  const initialToggleDisabled = toggle.disabled;

  const input = document.querySelector('input[aria-label="TypeSafe API key"]');
  if (!input) throw new Error("TypeSafe API key field is missing");
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  valueSetter.call(input, "jev-ui-fixture-key");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  const save = button("Save key");
  if (!save || save.disabled) throw new Error("Save action did not enable for a key");
  flushSync(() => save.click());
  await waitFor(() => document.body.innerText.includes("API key saved securely"), "saved key state was not shown");
  const keySavedInHost = typeof savedKey === "string";
  if (input.value !== "") throw new Error("Saved key draft should be cleared");

  const enable = document.querySelector('[role="switch"][aria-label="Enable Jev for Agent"]');
  flushSync(() => enable.click());
  await waitFor(() => enable.getAttribute("aria-checked") === "true", "Jev setting did not turn on");

  flushSync(() => button("Remove key").click());
  await waitFor(() => document.body.innerText.includes("API key not configured"), "removed key state was not shown");
  const finalToggle = document.querySelector('[role="switch"][aria-label="Enable Jev for Agent"]');
  const writes = apiCalls.filter((call) => call.channel === "pi-desktop/settings/set");
  const secretWrites = apiCalls.filter((call) => [
    "pi-desktop/secrets/set", "pi-desktop/secrets/delete",
  ].includes(call.channel));
  return {
    initialToggleDisabled,
    keySavedInHost,
    keyDraftCleared: input.value === "",
    enabledSettingPersisted: writes.some((call) => call.input.jevEnabled === true),
    disabledAfterRemoval: finalToggle.getAttribute("aria-checked") === "false",
    keyRemovedFromHost: savedKey === undefined,
    allSecretRefsFixed: secretWrites.every((call) =>
      call.channel === "pi-desktop/secrets/set"
        ? call.input.secretRef === JEV_API_KEY_SECRET_REF
        : call.input === JEV_API_KEY_SECRET_REF),
    noKeyInSettings: writes.every((call) => !Object.values(call.input).includes("jev-ui-fixture-key")),
  };
};
`;

test("Jev settings stores a secret, enables Jev, then disables and removes it", {
  timeout: 60_000,
  skip:
    process.platform === "linux" && !process.env.DISPLAY
      ? "Isolated Electron UI test requires a display"
      : false,
}, async () => {
  const temp = await mkdtemp(join(root, "apps/desktop/.jev-settings-ui-"));
  try {
    await build({
      stdin: {
        contents: fixtureSource,
        resolveDir: join(root, "scripts", "e2e"),
        sourcefile: join(root, "scripts", "e2e", "jev-settings.jsx"),
        loader: "tsx",
      },
      outfile: join(temp, "renderer.js"),
      bundle: true,
      platform: "browser",
      format: "esm",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      alias: {
        "@pi-desktop/i18n": join(root, "packages/i18n/src"),
        react: join(root, "apps/desktop/node_modules/react"),
        "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
        i18next: join(root, "apps/desktop/node_modules/i18next"),
        "react-i18next": join(root, "apps/desktop/node_modules/react-i18next"),
      },
      nodePaths: [join(root, "apps/desktop/node_modules")],
    });
    await writeFile(
      join(temp, "index.html"),
      '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'"><body><div id="root"></div><script type="module" src="renderer.js"></script>',
    );
    await writeFile(
      join(temp, "main.cjs"),
      `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 700,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", (event) => console.error(event.message));
  try {
    await win.loadFile(path.join(__dirname, "index.html"));
    const result = await win.webContents.executeJavaScript("window.jevSettingsProbe()");
    console.log("JEV_SETTINGS_PROBE " + JSON.stringify(result));
    app.exit(0);
  } catch (error) { console.error(error?.stack ?? error); app.exit(1); }
});
`,
    );

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(resolveElectronBinary(root).electronBinary, [join(temp, "main.cjs")], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => { output += chunk; });
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
    } finally {
      clearTimeout(timer);
    }
    assert.equal(code, 0, output.slice(-6000));
    const line = output.split(/\r?\n/).find((item) => item.startsWith("JEV_SETTINGS_PROBE "));
    assert(line, output.slice(-6000));
    const result = JSON.parse(line.slice("JEV_SETTINGS_PROBE ".length));
    assert.deepEqual(result, {
      initialToggleDisabled: true,
      keySavedInHost: true,
      keyDraftCleared: true,
      enabledSettingPersisted: true,
      disabledAfterRemoval: true,
      keyRemovedFromHost: true,
      allSecretRefsFixed: true,
      noKeyInSettings: true,
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

/**
 * Isolated Electron user path for Jev settings (D625, settings IA).
 *
 * What the card is now: the state of the integration and the way in. It reads
 * whether a TypeSafe key is stored, lets the switch move only when one is, and
 * sends the user to the service dialog to add or replace the key — it never
 * stores a key itself. Removing the key takes the switch down first.
 *
 * The key is written by the service dialog (see the Jev service setup test);
 * this fixture stands in for that by storing one in the fake Host and
 * remounting the card.
 */
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
let configureClicks = 0;
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
        if (input !== JEV_API_KEY_SECRET_REF) throw new Error("unexpected secret ref");
        return { ok: true, data: { has: typeof savedKey === "string" } };
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
  const [round, setRound] = React.useState(0);
  window.__remount = () => setRound((value) => value + 1);
  return React.createElement(JevSettingsCard, {
    key: round,
    settings: settings ?? undefined,
    onConfigure: () => { configureClicks += 1; },
  });
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
  const toggle = () => document.querySelector('[role="switch"][aria-label="Enable Jev for Agent"]');
  if (!toggle()) throw new Error("the Jev switch is missing");
  const initialToggleDisabled = toggle().disabled;

  const addKey = button("Add key");
  if (!addKey) throw new Error("the card must offer adding a key");
  flushSync(() => addKey.click());
  await settle();
  const configureOpened = configureClicks === 1;

  // Without a key the switch stays refused, whatever the card offers.
  flushSync(() => toggle().click());
  await settle();
  // Pressing a switch that has no key behind it must not write a setting.
  const refusedWithoutKey = toggle().getAttribute("aria-checked") === "false"
    && !apiCalls.some((call) => call.channel === "pi-desktop/settings/set");

  // A key the service dialog stored is what the next mount reads.
  savedKey = "jev-ui-fixture-key";
  flushSync(() => window.__remount());
  await waitFor(() => document.body.innerText.includes("API key saved securely"), "configured state missing");
  const replaceOffered = Boolean(button("Replace key"));
  const removeOffered = Boolean(button("Remove key"));

  flushSync(() => toggle().click());
  await waitFor(() => toggle().getAttribute("aria-checked") === "true", "Jev setting did not turn on");

  const remove = button("Remove key");
  if (!remove) throw new Error("removing the key must stay possible");
  flushSync(() => remove.click());
  await waitFor(() => document.body.innerText.includes("API key not configured"), "removed key state was not shown");

  const finalToggle = toggle();
  const settingsWrites = apiCalls.filter((call) => call.channel === "pi-desktop/settings/set");
  const lastDisable = apiCalls.findLastIndex(
    (call) => call.channel === "pi-desktop/settings/set" && call.input.jevEnabled === false,
  );
  const firstDelete = apiCalls.findIndex((call) => call.channel === "pi-desktop/secrets/delete");
  return {
    initialToggleDisabled,
    configureOpened,
    refusedWithoutKey,
    replaceOffered,
    removeOffered,
    enabledSettingPersisted: settingsWrites.some((call) => call.input.jevEnabled === true),
    disabledAfterRemoval: finalToggle.getAttribute("aria-checked") === "false",
    toggleDisabledAfterRemoval: finalToggle.disabled === true,
    keyRemovedFromHost: savedKey === undefined,
    removalDisabledFirst: firstDelete !== -1 && lastDisable !== -1 && firstDelete > lastDisable,
    keyNeverStoredFromTheCard: !apiCalls.some((call) => call.channel === "pi-desktop/secrets/set"),
    storedKeyNeverInSettings: settingsWrites.every(
      (call) => !Object.values(call.input).includes("jev-ui-fixture-key"),
    ),
  };
};
`;

test("the Jev card reads the key, gates the switch, and disables before removing", {
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
      configureOpened: true,
      refusedWithoutKey: true,
      replaceOffered: true,
      removeOffered: true,
      enabledSettingPersisted: true,
      disabledAfterRemoval: true,
      toggleDisabledAfterRemoval: true,
      keyRemovedFromHost: true,
      removalDisabledFirst: true,
      keyNeverStoredFromTheCard: true,
      storedKeyNeverInSettings: true,
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

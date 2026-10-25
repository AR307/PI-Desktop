/** Real composer + IPC handlers + account HTTP; controlled provider, no personal profile. */
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { createServer } from "vite";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "apps/desktop/package.json"));
const { default: tailwindcss } = await import(pathToFileURL(require.resolve("@tailwindcss/vite")));
const { chromium } = require(process.env.PI_TEST_PLAYWRIGHT || "playwright");
const artifacts = join(root, ".artifacts", "account-benefits", String(Date.now()));
await mkdir(artifacts, { recursive: true });
const main = join(artifacts, "main.mjs");
await build({
  stdin: {
    contents: `export { MirrorCodingAccount } from "./apps/desktop/electron/main/mirrorcoding/account.ts"; export { MirrorCodingBenefitsService } from "./apps/desktop/electron/main/mirrorcoding/benefits.ts"; export { registerMirrorCodingIpc } from "./apps/desktop/electron/main/mirrorcoding/ipc.ts";`,
    resolveDir: root,
  },
  outfile: main,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "warning",
});
const { MirrorCodingAccount, MirrorCodingBenefitsService, registerMirrorCodingIpc } = await import(
  pathToFileURL(main)
);
let mode = "ready";
let posts = 0;
let refreshes = 0;
let rejectAccess = false;
let requests = 0;
const walletVisits = [];
let walletOpenFails = false;
const body = {
  success: true,
  data: {
    permissions: { subscriptions_read: true, check_in: true, wallet_read: true },
    wallet_balance: 2500000,
    quota_per_yuan: 100000,
    quota_per_unit: 500000,
    quota_unit: "credits",
    subscriptions: [
      {
        id: "1",
        name: "Pro Monthly",
        expires_at: "2099-12-31T00:00:00Z",
        quota_total: 5000000,
        quota_used: 1000000,
        next_reset_at: "2099-01-01T00:00:00Z",
        groups: ["default"],
      },
      {
        id: "2",
        name: "Team Add-on",
        expires_at: "2099-10-31T00:00:00Z",
        quota_total: 5000000,
        quota_used: 1000000,
        next_reset_at: null,
        groups: ["coding"],
      },
      {
        id: "expired",
        name: "Expired plan",
        expires_at: "2000-01-01T00:00:00Z",
        quota_total: 100,
        quota_used: 0,
        next_reset_at: null,
        groups: [],
      },
    ],
    check_in: {
      enabled: true,
      checked_in: false,
      date: "2026-10-18",
      time_zone: "Asia/Shanghai",
      reward: null,
    },
  },
};
const server = createHttpServer(async (req, res) => {
  const reply = (status, value) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (req.url === "/api/pi-desktop/oauth/token") {
    refreshes++;
    return reply(200, {
      access_token: "fixture-refreshed",
      refresh_token: "fixture-refresh-next",
      token_type: "Bearer",
      expires_in: 900,
      refresh_expires_in: 86400,
      authorization_id: "A",
    });
  }
  requests++;
  if (rejectAccess && req.headers.authorization !== "Bearer fixture-refreshed")
    return reply(401, { error: "invalid_token" });
  if (!req.headers.authorization?.startsWith("Bearer fixture-")) return reply(401, {});
  if (mode === "unavailable") return reply(404, {});
  if (mode === "forbidden") return reply(403, {});
  if (mode === "offline") return reply(503, {});
  if (req.url === "/api/pi-desktop/account/checkin" && req.method === "POST") {
    posts++;
    body.data.check_in.checked_in = true;
    body.data.check_in.reward = 250000;
    body.data.wallet_balance += 250000;
    return reply(200, body);
  }
  if (req.url === "/api/pi-desktop/account/benefits" && req.method === "GET")
    return reply(200, body);
  reply(404, {});
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const saved = {
  active: {
    accessToken: "fixture-access",
    refreshToken: "fixture-refresh",
    accessExpiresAt: Date.now() + 900000,
    authorizationExpiresAt: Date.now() + 86400000,
    authorizationId: "A",
    catalog: { user: { id: 42, displayName: "Fixture user" }, groups: [], supportedEndpoints: {} },
  },
  pendingRevocations: [],
};
const account = new MirrorCodingAccount({
  origin: `http://127.0.0.1:${server.address().port}`,
  credentials: { load: async () => saved, save: async () => {}, assertAvailable() {} },
  fetch,
  modelsDev: { ensureLoaded: async () => {}, findModel: () => undefined },
  openExternal: async () => {},
  completeWelcome: async () => {},
  syncProviders: async () => {},
  changed() {},
});
await account.initialize();
const benefits = new MirrorCodingBenefitsService(account);
const handlers = new Map();
registerMirrorCodingIpc({
  registrar: {
    handleWithEvent: (channel, fn) => handlers.set(channel, fn),
    assertMainWindowSender: (event) => assert.equal(event.sender, "main-fixture"),
  },
  runtime: { account, benefits },
  activeTurns: new Map(),
  abort: async () => {},
  forgetMobileDevice: async () => {},
});
await assert.rejects(() =>
  handlers.get("pi-desktop/mirrorcoding/benefits")({ sender: "untrusted" }),
);
const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import i18n from 'i18next'; import {initReactI18next} from 'react-i18next';
import {zhCN} from '@pi-desktop/i18n/locales/zh-CN';
import {ComposerToolbar} from '/src/features/chat/composer/ComposerToolbar.tsx';
import {AccountBenefitsSettings} from '/src/features/account/AccountBenefits.tsx';
import {useMirrorCoding} from '/src/features/account/state.ts';
import {TOOLBAR_PROPS} from '/test/helpers/composer-toolbar.mjs';
import '/src/styles/globals.css';
import '/src/features/chat/side-chat.css';
window.piDesktop={platform:'win32',invoke:(channel,...args)=>window.fixtureInvoke(channel,...args),on:()=>()=>{}};
await i18n.use(initReactI18next).init({lng:'zh-CN',resources:{'zh-CN':{translation:zhCN}},interpolation:{escapeValue:false}});
const connected={status:'connected',sync:'success',pendingRevocation:false,account:{id:42,displayName:'Fixture'},authorizationExpiresAt:9999999999999};
useMirrorCoding.setState({account:connected});
window.fixtureAccount=(signedIn,id=42)=>useMirrorCoding.setState({account:signedIn?{...connected,account:{...connected.account,id}}:{status:'signed_out',sync:'idle',pendingRevocation:false}});
document.documentElement.dataset.theme='dark';
const props={...TOOLBAR_PROPS,t:i18n.t.bind(i18n),contextUsage:null,modelLabel:'gpt-6-astra',thinkingLabel:'medium'};
const view = createRoot(document.getElementById('root'));
window.fixtureSettings = (show=true) => view.render(<div style={{height:'100vh',padding:24,display:'flex',alignItems:'flex-end'}}>{show&&<div style={{position:'absolute',top:20,left:24,maxWidth:480}}><AccountBenefitsSettings/></div>}<div className='composer-stack' style={{width:'100%'}}><div className='composer'><div style={{padding:18,color:'var(--ds-text-muted)'}}>随便问问</div><ComposerToolbar {...props}/></div></div></div>);
window.fixtureSettings(false);
window.fixtureComposerWidth = (width, side) => view.render(
  <div className={side ? 'side-chat-pane' : ''} style={{position:'relative',width,height:500}}>
    <div className='composer-dock composer-dock-docked'>
      <div className='composer-stack'><div className='composer-shell'>
        <div className='composer-input-wrap'><div className='composer-input'>Layout test</div></div>
        <ComposerToolbar {...props} contextUsage={TOOLBAR_PROPS.contextUsage} thinkingLevel='high' thinkingLabel='high'/>
      </div></div>
    </div>
  </div>
);
`;
const vite = await createServer({
  root: join(root, "apps/desktop"),
  configFile: false,
  esbuild: { jsx: "automatic" },
  plugins: [
    tailwindcss(),
    {
      name: "benefits-acceptance",
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url !== "/benefits-test") return next();
          res.setHeader("content-type", "text/html");
          res.end(
            '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/benefits-entry.tsx"></script></body></html>',
          );
        });
      },
      resolveId(id) {
        if (id === "/benefits-entry.tsx") return join(root, "apps/desktop/benefits-entry.tsx");
      },
      load(id) {
        if (id.endsWith("/benefits-entry.tsx")) return entry;
      },
    },
  ],
  logLevel: "warn",
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [root, resolve(require.resolve("react"), "../../../../../..")] },
  },
});
let browser;
const findings = [];
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1122, height: 902 } });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Renderer error:", error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error("Browser:", message.text());
  });
  await page.exposeFunction("fixtureInvoke", async (channel, ...args) => {
    try {
      if (channel === "pi-desktop/browser/openExternal") {
        if (walletOpenFails) throw new Error("Browser unavailable");
        walletVisits.push(args[0].url);
        return { ok: true, data: { ok: true } };
      }
      const handler = handlers.get(channel);
      assert(handler, `Unexpected channel ${channel}`);
      return { ok: true, data: await handler({ sender: "main-fixture" }, ...args) };
    } catch (error) {
      return { ok: false, error: { code: "FIXTURE_FAILURE", message: error.message } };
    }
  });
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/benefits-test`);
  const trigger = page.locator(".mc-quota-trigger");
  const bar = page.locator("[data-testid=subscription-quota-bar]");
  const wallet = page.locator(".mc-wallet-trigger");
  const settings = page.locator(".settings-card-block");
  const walletDialog = page.getByRole("dialog", { name: "前往钱包？" });
  await page.waitForFunction(() => document.querySelector(".mc-quota-track.is-green"));
  assert.match(await wallet.textContent(), /25.00/);
  const walletBounds = await wallet.boundingBox();
  const barBounds = await trigger.boundingBox();
  assert(walletBounds.x + walletBounds.width <= barBounds.x, "wallet must be left of the subscription bar");
  await wallet.click();
  await walletDialog.waitFor();
  assert.equal(walletVisits.length, 0, "clicking balance must ask before navigation");
  await page.screenshot({ path: join(artifacts, "wallet-confirm-dark.png") });
  await walletDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(walletVisits.length, 0);
  await wallet.focus();
  await page.keyboard.press("Enter");
  await walletDialog.waitFor();
  await page.keyboard.press("Escape");
  await walletDialog.waitFor({ state: "hidden" });
  assert.equal(walletVisits.length, 0);
  await wallet.click();
  walletOpenFails = true;
  await walletDialog.getByRole("button", { name: "前往钱包", exact: true }).click();
  await walletDialog.getByRole("alert").waitFor();
  assert.equal(walletVisits.length, 0);
  walletOpenFails = false;
  await walletDialog.getByRole("button", { name: "前往钱包", exact: true }).click();
  await walletDialog.waitFor({ state: "hidden" });
  assert.deepEqual(walletVisits, ["https://console.mirrorcoding.xyz/wallet"]);
  findings.push("wallet before quota; cancel/Escape do not navigate; confirmed fixed wallet URL; failed open retries");
  assert.equal(await trigger.textContent(), "", "closed bar has no percentage text");
  await trigger.hover();
  await page.getByRole("tooltip").filter({ hasText: "80%" }).waitFor();
  await page.screenshot({ path: join(artifacts, "01-hover-dark.png") });
  const toolbarBounds = await page.locator(".composer-toolbar").boundingBox();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "账号订阅" });
  await dialog.waitFor();
  await dialog.getByText("Pro Monthly", { exact: true }).waitFor();
  async function assertPopoverPosition() {
    await page.waitForFunction(
      () => {
        const dialog = document.querySelector(".mc-benefits-popover.is-open");
        if (!dialog) return false;
        const box = dialog.getBoundingClientRect();
        return box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
      },
      undefined,
      { timeout: 3000 },
    );
    assert.equal(await dialog.evaluate((element) => getComputedStyle(element).position), "fixed");
  }
  await assertPopoverPosition();
  assert.deepEqual(
    await page.locator(".composer-toolbar").boundingBox(),
    toolbarBounds,
    "opening the popup must not move the composer",
  );
  const popupBounds = await dialog.boundingBox();
  const triggerBounds = await trigger.boundingBox();
  assert(
    popupBounds.y + popupBounds.height <= triggerBounds.y,
    "bottom dock popup opens above its trigger",
  );
  assert.equal(await dialog.getByText("Team Add-on", { exact: true }).count(), 1);
  assert.equal(await dialog.getByText("Expired plan", { exact: true }).count(), 0);
  await dialog.getByRole("button", { name: "签到", exact: true }).click();
  await dialog.getByRole("button", { name: "今日已签到" }).waitFor();
  assert.equal(posts, 1);
  assert.match(await wallet.textContent(), /27.50/, "check-in refreshes wallet without adding subscription quota");
  assert(await dialog.getByRole("button", { name: "今日已签到" }).isDisabled());
  await page.screenshot({ path: join(artifacts, "02-subscriptions-dark.png") });
  findings.push("hover, active subscriptions, expiry, check-in, one POST");
  for (const [used, tone] of [
    [3500000, "yellow"],
    [4500000, "red"],
  ]) {
    body.data.subscriptions[0].quota_used = used;
    body.data.subscriptions[1].quota_used = used;
    await dialog.getByRole("button", { name: "刷新", exact: true }).click();
    await page.waitForFunction(
      (tone) => document.querySelector(".mc-quota-track.is-" + tone),
      tone,
    );
    await page.screenshot({ path: join(artifacts, `quota-${tone}-dark.png`) });
  }
  rejectAccess = true;
  await dialog.getByRole("button", { name: "刷新", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".mc-benefits-panel[aria-busy=true]"));
  assert.equal(refreshes, 1);
  findings.push("yellow/red thresholds and OAuth 401 refresh");
  for (const state of ["unavailable", "forbidden", "offline"]) {
    mode = state;
    const panel = state === "unavailable" ? dialog : settings;
    await panel.getByRole("button", { name: "刷新", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 3000 });
    await page.evaluate(() => window.fixtureSettings());
    await settings.getByRole("alert").waitFor();
    assert.equal(await settings.locator(".mc-subscription").count(), 0);
    assert.equal(await bar.count(), 0, "failed data hides the subscription bar");
    assert.equal(await wallet.textContent(), "余额 —", "failed data does not display stale or fake-zero balance");
  }
  mode = "ready";
  await settings.getByRole("button", { name: "刷新", exact: true }).click();
  await settings.getByText("Pro Monthly", { exact: true }).waitFor();
  await page.evaluate(() => window.fixtureSettings(false));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await trigger.click();
  await dialog.getByText("Pro Monthly", { exact: true }).waitFor();
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.setViewportSize({ width: 760, height: 640 });
  await assertPopoverPosition();
  await page.screenshot({ path: join(artifacts, "03-narrow-light.png") });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  const subscriptions = structuredClone(body.data.subscriptions);
  body.data.subscriptions = [];
  await dialog.getByRole("button", { name: "刷新", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.evaluate(() => window.fixtureSettings());
  await settings.getByText("暂无有效订阅", { exact: true }).waitFor();
  assert.equal(await bar.count(), 0, "no active plan hides the bar");
  assert.match(await wallet.textContent(), /27.50/, "wallet remains visible without subscriptions");
  const refreshAndWait = async () => {
    await settings.getByRole("button", { name: "刷新", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".mc-benefits-panel[aria-busy=true]"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(() => !document.querySelector(".mc-benefits-panel[aria-busy=true]"));
  };
  for (const remaining of [0, 49999, 50000, 50001]) {
    body.data.subscriptions = [{ ...subscriptions[0], quota_used: subscriptions[0].quota_total - remaining }];
    await refreshAndWait();
    assert.equal(await bar.count(), remaining > 50000 ? 1 : 0, "strict per-subscription RMB threshold");
  }
  body.data.subscriptions = subscriptions.slice(0, 2).map(item => ({ ...item, quota_used: item.quota_total - 30000 }));
  await refreshAndWait();
  assert.equal(await bar.count(), 0, "two small plans must not combine to pass the threshold");
  body.data.subscriptions = [{ ...subscriptions[0], expires_at: "2000-01-01T00:00:00Z" }];
  await refreshAndWait();
  assert.equal(await bar.count(), 0, "expired plans hide the bar");
  body.data.wallet_balance = 0;
  await refreshAndWait();
  assert.match(await wallet.textContent(), /0.00/, "actual zero wallet balance remains visible");
  delete body.data.wallet_balance;
  delete body.data.quota_per_yuan;
  delete body.data.permissions.wallet_read;
  body.data.subscriptions = subscriptions;
  await refreshAndWait();
  assert.equal(await wallet.textContent(), "余额 —");
  assert.equal(await bar.count(), 0, "missing conversion must not guess RMB value");
  await page.evaluate(() => window.fixtureSettings(false));
  await page.screenshot({ path: join(artifacts, "missing-wallet-fields-light.png") });
  body.data.permissions.wallet_read = true;
  body.data.wallet_balance = 2750000;
  body.data.quota_per_yuan = 100000;
  findings.push("zero wallet, missing fields, empty/expired/exhausted/threshold subscriptions, per-plan not aggregated");
  body.data.subscriptions = subscriptions;
  body.data.subscriptions[0].quota_total = null;
  await page.evaluate(() => window.fixtureSettings());
  await refreshAndWait();
  await settings.getByText("订阅额度不限量", { exact: true }).waitFor();
  assert((await bar.getAttribute("class")).includes("is-green"));
  assert((await trigger.getAttribute("aria-label")).includes("订阅额度不限量"));
  await page.evaluate(() => window.fixtureSettings(false));
  await wallet.click();
  await walletDialog.waitFor();
  await page.evaluate(() => window.fixtureAccount(true, 43));
  await walletDialog.waitFor({ state: "hidden" });
  await wallet.click();
  await walletDialog.waitFor();
  await page.evaluate(() => window.fixtureAccount(false));
  await walletDialog.waitFor({ state: "hidden" });
  await wallet.waitFor({ state: "hidden" });
  await trigger.waitFor({ state: "hidden" });
  await dialog.waitFor({ state: "hidden" });
  await page.evaluate(() => window.fixtureAccount(true));
  await trigger.waitFor();
  assert.equal(
    await trigger.getAttribute("aria-expanded"),
    "false",
    "sign-in does not reopen the previous account popup",
  );
  body.data.check_in.checked_in = false;
  body.data.check_in.reward = null;
  await page.evaluate(() => {
    window.fixtureAccount(true);
    window.fixtureSettings();
  });
  await settings.getByRole("button", { name: "签到", exact: true }).click();
  await settings.getByRole("button", { name: "今日已签到" }).waitFor();
  assert.equal(posts, 2, "settings uses the same explicit check-in flow");
  findings.push("empty/unlimited subscriptions and Account settings check-in");
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => (document.documentElement.dataset.theme = theme), theme);
    for (const width of [360, 400, 450, 500, 560, 640, 900]) {
      const layouts = [];
      for (const side of [false, true]) {
        await page.evaluate(({width, side}) => window.fixtureComposerWidth(width, side), {width, side});
        await page.locator('.mc-quota-trigger').waitFor();
        await page.waitForFunction(({width, side}) => {
          const pane = document.querySelector('#root > div');
          return pane?.getBoundingClientRect().width === width && pane.classList.contains('side-chat-pane') === side;
        }, {width, side});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const layout = await page.locator('.composer-toolbar').evaluate(toolbar => {
          const bounds = toolbar.getBoundingClientRect();
          const rects = [...toolbar.querySelectorAll('button')].map(button => button.getBoundingClientRect()).filter(rect => rect.width && rect.height);
          const rows = rects.map(rect => rect.y + rect.height / 2);
          return { overflow: toolbar.scrollWidth - toolbar.clientWidth,
            rowSpread: Math.max(...rows) - Math.min(...rows),
            contained: rects.every(rect => rect.left >= bounds.left && rect.right <= bounds.right),
            overlapping: rects.some((rect, index) => rects.slice(index + 1).some(other =>
              Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 1 &&
              Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 1)),
            height: bounds.height,
            modelDisplay: getComputedStyle(toolbar.querySelector('.composer-model-thinking-model')).display };
        });
        if (layout.overlapping) {
          console.log(await page.locator('.composer-toolbar').evaluate(toolbar => [...toolbar.querySelectorAll('button')].map(button => {
            const box = button.getBoundingClientRect();
            return {class: button.className, x: box.x, y: box.y, width: box.width};
          })));
          await page.screenshot({path: join(artifacts, 'composer-overlap.png')});
        }
        assert.ok(layout.overflow <= 2 && layout.contained && !layout.overlapping && layout.rowSpread <= 2,
          `${theme} ${width}px ${side ? 'side' : 'main'} account toolbar must fit one row: ${JSON.stringify(layout)}`);
        layouts.push(layout);
      }
      assert.deepEqual(layouts[1], layouts[0], 'main and side use the same responsive composer rules');
      await page.screenshot({path: join(artifacts, `composer-${width}-${theme}.png`)});
    }
  }
  findings.push("signed-in main/side toolbar parity at seven widths from 360 to 900px in dark/light");
  findings.push("hidden quota closes popup; settings recovery remains usable; account switch closes wallet confirmation");
  assert.deepEqual(errors, []);
  findings.push("unavailable/denied/offline, narrow/light, keyboard, logout");
  const revision = (ref) =>
    execFileSync("git", ["rev-parse", ref], { cwd: root, encoding: "utf8" }).trim();
  const result = {
    candidate: revision("HEAD"),
    base: revision("origin/main"),
    environment: `Chromium ${browser.version()} on ${process.platform}; local HTTP and IPC handlers; fixture preload and credentials`,
    findings,
    requests,
    posts,
    refreshes,
  };
  await writeFile(join(artifacts, "results.json"), JSON.stringify(result, null, 2));
  console.log("PASS", JSON.stringify(result));
} finally {
  await browser?.close();
  await vite.close();
  benefits.dispose();
  account.dispose();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  console.log("Artifacts retained:", artifacts);
}

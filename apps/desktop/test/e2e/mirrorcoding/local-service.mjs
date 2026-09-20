import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

export function docker(...args) { return execFileSync("docker", args, { encoding: "utf8", windowsHide: true }).trim(); }

export async function startMirrorCoding(upstreamPort) {
  const name = `pi-desktop-mirrorcoding-${Date.now()}`;
  const password = `PiQa!${randomBytes(16).toString("hex")}`;
  const env = {
    SQLITE_PATH: "/data/new-api.db", SESSION_SECRET: randomBytes(32).toString("hex"), CRYPTO_SECRET: randomBytes(32).toString("hex"),
    SESSION_COOKIE_SECURE: "false", GLOBAL_API_RATE_LIMIT_ENABLE: "false", GLOBAL_WEB_RATE_LIMIT_ENABLE: "false",
    CRITICAL_RATE_LIMIT_ENABLE: "false", BATCH_UPDATE_ENABLED: "false", MEMORY_CACHE_ENABLED: "false",
  };
  docker("run", "-d", "--name", name, "-p", "127.0.0.1::3000", "-v", `${name}:/data`, ...Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]), process.env.MIRRORCODING_TEST_IMAGE ?? "localhost/mirrorcoding-pi-auth:20260920");
  const origin = `http://127.0.0.1:${docker("port", name, "3000/tcp").split(":").at(-1)}`;
  let bearer;
  const api = async (method, path, body) => {
    const response = await fetch(`${origin}${path}`, { method, headers: { "Content-Type": "application/json", Origin: origin, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok || !value.success) throw new Error(`Local MirrorCoding ${path}: ${response.status} ${value.message ?? ""}`);
    return value.data;
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${origin}/api/status`)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await api("POST", "/api/setup", { username: "piqa", password, confirmPassword: password });
  const login = await api("POST", "/api/user/login", { username: "piqa", password });
  bearer = login.access_token;
  await api("PUT", "/api/option/", { key: "SelfUseModeEnabled", value: "true" });
  const groups = { default: "Default", OpenAI: "OpenAI", "中文 分组": "Chinese group", auto: "Auto" };
  for (const [key, value] of Object.entries({ GroupRatio: { default: 1, OpenAI: 0.2, "中文 分组": 0.4 }, GroupGroupRatio: { default: { OpenAI: 0.06, "中文 分组": 0.12 } }, UserUsableGroups: groups, AutoGroups: ["OpenAI", "中文 分组"] })) {
    await api("PUT", "/api/option/", { key, value: JSON.stringify(value) });
  }
  for (const [type, models] of [[1, "gpt-4o-mini"], [60, "gpt-5"], [14, "claude-sonnet-4-5"], [24, "gemini-2.5-flash"]]) {
    await api("POST", "/api/channel/", { mode: "single", channel: { name: `Local protocol ${type}`, type, key: "local-fixture", base_url: `http://host.docker.internal:${upstreamPort}`, models, group: "default,OpenAI,中文 分组", status: 1, auto_ban: 0 } });
  }
  await api("PUT", "/api/user/", { id: login.user.id, username: "piqa", display_name: "PI local acceptance", quota: 100000000, group: "default" });
  await api("PUT", "/api/subscription/self/preference", { billing_preference: "wallet_only" });
  return { origin, name, password, api, stop() { docker("stop", name); } };
}

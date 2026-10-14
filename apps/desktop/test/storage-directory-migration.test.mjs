import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const artifacts = join(root, ".artifacts");
await mkdir(artifacts, { recursive: true });
const scratch = await realpath(await mkdtemp(join(artifacts, "storage-directory-tests-")));
const { build } = createRequire(new URL("../../../packages/agent-runtime/package.json", import.meta.url))("esbuild");
const bundle = join(scratch, "storage.mjs");
await build({ entryPoints: [join(root, "apps/desktop/electron/main/storage/files.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", alias: { "original-fs": "node:fs" } });
const storage = await import(pathToFileURL(bundle).href);

async function fixture() {
  const directory = await mkdtemp(join(scratch, "case-"));
  const source = { data: join(directory, "data"), browser: join(directory, "browser") };
  await mkdir(source.browser);
  return { directory, source, target: join(directory, "new drive", "PI storage") };
}

test("first-install migration creates a selected destination that does not exist", async () => {
  const { source, target } = await fixture();
  const selected = await storage.validateTarget(target, source, source.browser);
  assert.equal(selected, await realpath(target));
  const next = await storage.migrateFiles({ source, target: selected, anchor: source.browser, id: randomUUID(), progress: () => {}, relocate: async () => { assert.fail("An absent source needs no offline relocation"); } });
  assert.equal((await stat(next.data)).isDirectory(), true);
  assert.equal((await stat(next.browser)).isDirectory(), true);
  await assert.rejects(stat(source.data), { code: "ENOENT" });
});

test("first-install validation handles several missing source ancestors", async () => {
  const value = await fixture();
  value.source.data = join(value.directory, "not initialized", "PI", "data");
  await mkdir(value.target, { recursive: true });
  assert.equal(await storage.validateTarget(value.target, value.source, value.source.browser), await realpath(value.target));
  const next = await storage.migrateFiles({ source: value.source, target: await realpath(value.target), anchor: value.source.browser,
    id: randomUUID(), progress: () => {}, relocate: async () => { assert.fail("No old data exists to relocate"); } });
  assert.equal((await stat(next.data)).isDirectory(), true);
  await assert.rejects(stat(join(value.directory, "not initialized")), { code: "ENOENT" });
});

test("existing conversations migrate to a newly selected destination without changing originals", async () => {
  const { source, target } = await fixture();
  await mkdir(join(source.data, "sessions"), { recursive: true });
  await writeFile(join(source.data, "sessions", "conversation.jsonl"), "existing conversation\n");
  await writeFile(join(source.browser, "Preferences"), '{"fixture":true}');
  const selected = await storage.validateTarget(target, source, source.browser);
  let relocated = false;
  const next = await storage.migrateFiles({ source, target: selected, anchor: source.browser, id: randomUUID(), progress: () => {}, relocate: async (from, to) => {
    assert.equal(from, source.data);
    assert.equal(await readFile(join(to, "sessions", "conversation.jsonl"), "utf8"), "existing conversation\n");
    relocated = true;
  } });
  assert.equal(relocated, true);
  assert.equal(await readFile(join(source.data, "sessions", "conversation.jsonl"), "utf8"), "existing conversation\n");
  assert.equal(await readFile(join(next.browser, "Preferences"), "utf8"), '{"fixture":true}');
});

test("migration excludes only the browser installation lock, not user files named lockfile", async () => {
  const { source, target } = await fixture();
  await mkdir(source.data);
  await mkdir(join(source.browser, "user-files"));
  await writeFile(join(source.browser, "lockfile"), "installation lock");
  await writeFile(join(source.data, "lockfile"), "user data");
  await writeFile(join(source.browser, "user-files/lockfile"), "nested user data");
  const selected = await storage.validateTarget(target, source, source.browser);
  const next = await storage.migrateFiles({ source, target: selected, anchor: source.browser, id: randomUUID(), progress: () => {}, relocate: async () => {} });
  await assert.rejects(stat(join(next.browser, "lockfile")), { code: "ENOENT" });
  assert.equal(await readFile(join(source.browser, "lockfile"), "utf8"), "installation lock");
  assert.equal(await readFile(join(next.data, "lockfile"), "utf8"), "user data");
  assert.equal(await readFile(join(next.browser, "user-files/lockfile"), "utf8"), "nested user data");
});

test("backup cleanup preflights active-root overlap before touching another old root", async () => {
  const { directory, source } = await fixture();
  await mkdir(source.data);
  const oldData = join(directory, "old-data");
  await mkdir(oldData);
  await writeFile(join(oldData, "history.txt"), "retained backup");
  await assert.rejects(storage.removeBackups([{ data: oldData, browser: source.browser }], source, source.browser), /overlaps active storage/);
  assert.equal(await readFile(join(oldData, "history.txt"), "utf8"), "retained backup");
});

test("overlapping destinations are rejected before creating folders", async () => {
  const { source } = await fixture();
  const target = join(source.browser, "new", "destination");
  await assert.rejects(storage.validateTarget(target, source, source.browser), /separate/);
  await assert.rejects(stat(join(source.browser, "new")), { code: "ENOENT" });
});

test("existing unrelated destination files remain untouched", async () => {
  const { source, target } = await fixture();
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "user-file.txt"), "keep me");
  await assert.rejects(storage.validateTarget(target, source, source.browser), /empty/);
  assert.equal(await readFile(join(target, "user-file.txt"), "utf8"), "keep me");
});

test("a missing target below a linked source still cannot overlap active storage", async () => {
  const { directory, source } = await fixture();
  const alias = join(directory, "browser alias");
  await symlink(source.browser, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(storage.validateTarget(join(alias, "new target"), source, source.browser), /separate/);
  await assert.rejects(stat(join(source.browser, "new target")), { code: "ENOENT" });
});

test("a linked destination is rejected instead of writing through the link", async () => {
  const { directory, source, target } = await fixture();
  await mkdir(target, { recursive: true });
  const alias = join(directory, "destination alias");
  await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(storage.validateTarget(alias, source, source.browser), /symbolic link/);
});

test("a destination that is a file is rejected without changing it", async () => {
  const { directory, source } = await fixture();
  const target = join(directory, "document.txt");
  await writeFile(target, "user document");
  await assert.rejects(storage.validateTarget(target, source, source.browser), /directory/);
  assert.equal(await readFile(target, "utf8"), "user document");
});

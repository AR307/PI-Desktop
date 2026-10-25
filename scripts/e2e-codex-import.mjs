#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "packages/agent-runtime/package.json"));
const { build } = require("esbuild");
const desktopRequire = createRequire(join(root, "apps/desktop/package.json"));
const { compile } = desktopRequire("@tailwindcss/node");
const { Scanner } = desktopRequire("@tailwindcss/oxide");
const evidence = join(root, "artifacts", `codex-import-${Date.now()}`);
await mkdir(join(evidence, "source/sessions"), { recursive: true });
await mkdir(join(evidence, "source/archived_sessions"), { recursive: true });
await mkdir(join(evidence, "workspace"));
for (const id of ["first", "second"]) {
  const records = [
    { type: "session_meta", payload: { id, cwd: join(evidence, "workspace"), title: `Imported ${id}`, timestamp: "2026-10-25T00:00:00Z" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "OLD_HISTORY" }] } },
    { type: "compacted", payload: { message: "DO_NOT_DUPLICATE", replacement_history: [{ type: "message", role: "user", content: [{ type: "input_text", text: "EFFECTIVE_SUMMARY" }] }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "LATEST_ANSWER" }] } },
  ];
  if (id === "second") records[2].payload.retained_context = { user_messages_incomplete: true };
  await writeFile(join(evidence, `source/${id === "first" ? "archived_sessions" : "sessions"}/${id}.jsonl`), records.map((r) => JSON.stringify(r) + "\n").join(""));
}
await build({ entryPoints: [join(root, "scripts/e2e/codex-import-ui.tsx")], outfile: join(evidence, "renderer.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic", loader: { ".png": "file", ".svg": "file", ".woff": "file", ".woff2": "file", ".ttf": "file" }, define: { "process.env.NODE_ENV": '"production"' }, alias: { "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"), react: join(root, "apps/desktop/node_modules/react"), "react-dom": join(root, "apps/desktop/node_modules/react-dom") }, nodePaths: [join(root, "apps/desktop/node_modules")] });
await build({ entryPoints: [join(root, "apps/desktop/electron/main/ipc/codex-import-ipc.ts")], outfile: join(evidence, "ipc.cjs"), bundle: true, platform: "node", format: "cjs", external: ["electron"] });
const css = await readFile(join(root, "apps/desktop/src/styles/globals.css"), "utf8");
const compiler = await compile(css, { base: join(root, "apps/desktop/src/styles"), onDependency() {} });
const scanner = new Scanner({ sources: [{ base: join(root, "apps/desktop/src"), pattern: "**/*.{ts,tsx}", negated: false }] });
await writeFile(join(evidence, "renderer.css"), compiler.build(scanner.scan()) + await readFile(join(root, "apps/desktop/src/features/codex-import/codex-import.css"), "utf8"));
await writeFile(join(evidence, "index.html"), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><body><script src="renderer.js"></script>');
await writeFile(join(evidence, "preload.cjs"), `const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("piDesktop",{platform:process.platform,invoke:(channel,...args)=>ipcRenderer.invoke(channel,...args),on:()=>()=>{}});`);
await writeFile(join(evidence, "main.cjs"), `
const {app,BrowserWindow,ipcMain}=require("electron");const path=require("node:path");const fs=require("node:fs/promises");
const {registerCodexImportIpc}=require("./ipc.cjs");
app.setPath("userData",path.join(__dirname,"profile"));
app.whenReady().then(async()=>{
 const {DatabaseSync}=require("node:sqlite");
 const source=path.join(__dirname,"source"),workspace=path.join(__dirname,"workspace");
 const database=new DatabaseSync(path.join(source,"state_5.sqlite"));
 database.exec("CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,rollout_path TEXT,cwd TEXT,title TEXT,name TEXT,project_id TEXT,archived INTEGER); CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT); CREATE TABLE IF NOT EXISTS project_roots(project_id TEXT PRIMARY KEY,path TEXT,position INTEGER); INSERT OR IGNORE INTO projects VALUES('current-project','Imported workspace');");
 database.prepare("INSERT OR IGNORE INTO project_roots VALUES('current-project',?,0)").run(workspace);
 for(const id of ["first","second"]) database.prepare("INSERT OR IGNORE INTO threads VALUES(?,?,?,?,?,NULL,?)").run(id,path.join(source,id==="first"?"archived_sessions":"sessions",id+".jsonl"),workspace,"Original request","Imported "+id,id==="first"?1:0);
 database.close();
 if(process.env.CODEX_IMPORT_STAGE==="bulk-review") {
  for(const id of ["third","fourth","missing-context"]) {
   const records=[{type:"session_meta",payload:{id,title:"Review "+id,cwd:workspace}},{type:"response_item",payload:{type:"message",role:"user",content:"Visible history"}},{type:"compacted",payload:{replacement_history:id==="missing-context"?[]:[{type:"message",role:"user",content:"Available context"}],retained_context:{user_messages_incomplete:true}}}];
   await fs.writeFile(path.join(source,"sessions",id+".jsonl"),records.map(r=>JSON.stringify(r)+"\\n").join(""));
  }
 }
 await fs.writeFile(path.join(source,".codex-global-state.json"),JSON.stringify({
  "local-projects":{"legacy-project":{name:"Imported workspace",rootPaths:[workspace]}},
  "thread-project-assignments":Object.fromEntries(["first","second"].map(id=>[id,{projectKind:"local",projectId:"legacy-project"}])),
  "app-server-project-id-by-legacy-project-id-by-host":{["local:"+source]:{"legacy-project":"current-project"}}
 }));
 const {Host}=await import(${JSON.stringify(new URL("./e2e/host.mjs", import.meta.url).href)});
 const host=new Host(${JSON.stringify(process.env.PI_DESKTOP_HOST_BIN || join(root, "target/debug", process.platform === "win32" ? "pi-desktop-host-core.exe" : "pi-desktop-host-core"))},path.join(__dirname,"data"),{env:{CODEX_HOME:path.join(__dirname,"source")},quiet:true});
 await host.start();let scans=0;const adapter={call:(method,params,timeout)=>{if(method==="codex.import.scan")scans++;return host.call(method,params,timeout)}};
 const registrar={handle:(channel,handler)=>ipcMain.handle(channel,async(_event,...args)=>{try{return {ok:true,data:await handler(...args)}}catch(error){return {ok:false,error:{code:"TEST_RPC",message:String(error)}}}})};
 registerCodexImportIpc({registrar,getHost:()=>adapter});
 registrar.handle("pi-desktop/project-group/list",()=>host.call("project.groups.list"));
 registrar.handle("pi-desktop/session/list",()=>host.call("session.list"));
 registrar.handle("pi-desktop/updates/getState",()=>({status:"idle"}));
 const window=new BrowserWindow({show:false,width:1000,height:780,webPreferences:{sandbox:true,contextIsolation:true,preload:path.join(__dirname,"preload.cjs")}});
 window.webContents.on("console-message",event=>console.error(event.message));
 try{
  await window.loadFile(path.join(__dirname,"index.html"));
  const stage=process.env.CODEX_IMPORT_STAGE;
  console.log(JSON.stringify(await window.webContents.executeJavaScript("codexImportProbe("+JSON.stringify(stage)+")")));
  if(stage==="first"){assertNoScan();await window.reload();await new Promise(resolve=>window.webContents.once("did-finish-load",resolve));console.log(JSON.stringify(await window.webContents.executeJavaScript('codexImportProbe("reload-hidden")')));assertNoScan();}
  for(const theme of ["dark","light"]){await window.webContents.executeJavaScript('document.documentElement.dataset.theme='+JSON.stringify(theme));await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await fs.writeFile(path.join(__dirname,stage+"-"+theme+".png"),(await window.capturePage()).toPNG());}
  window.setSize(500,740);await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const fits=await window.webContents.executeJavaScript('!document.querySelector("[role=dialog]") || document.querySelector("[role=dialog]").getBoundingClientRect().right <= innerWidth');
  if(!fits)throw new Error("Narrow dialog overflows");await fs.writeFile(path.join(__dirname,stage+"-narrow.png"),(await window.capturePage()).toPNG());
  if(stage==="restart-hidden"){const sessions=await host.call("session.list");if(sessions.sessions.length!==1)throw new Error("Wrong selected import count");const detail=await host.call("session.get",{id:sessions.sessions[0].id});await fs.writeFile(path.join(__dirname,"imported.json"),JSON.stringify(detail,null,2));}
  function assertNoScan(){if(scans!==0)throw new Error("Hint scanned source without click");}
  await host.stop();app.quit();
 }catch(error){console.error(error);await host.stop();app.exit(1);}
});
`);
const electronBinary = process.env.PI_DESKTOP_ELECTRON_BIN || resolveElectronBinary(root).electronBinary;
for (const stage of ["card", "dismiss", "card-open", "first", "restart-visible", "restart-hidden", "partial-review", "partial", "bulk-review"]) {
  const env = { ...process.env, CODEX_IMPORT_STAGE: stage }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [join(evidence, "main.cjs")], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; for (const stream of [child.stdout,child.stderr]) stream.on("data", d=> output+=d);
  const timer=setTimeout(()=>child.kill(),60000);
  const code=await new Promise((resolve,reject)=>{child.once("close",resolve);child.once("error",reject)});clearTimeout(timer);
  await writeFile(join(evidence,`${stage}.log`),output);console.log(stage,output.slice(-3000));assert.equal(code,0);
}
console.log(`Codex import Electron evidence: ${evidence}`);

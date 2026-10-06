import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const gradle = await readFile(resolve(root, "android/app/build.gradle"), "utf8");
const variables = await readFile(resolve(root, "android/variables.gradle"), "utf8");
const versionCode = Number(gradle.match(/\bversionCode\s+(\d+)/)?.[1]);
const minAndroidSdk = Number(variables.match(/\bminSdkVersion\s*=\s*(\d+)/)?.[1]);
if (!Number.isSafeInteger(versionCode) || !Number.isSafeInteger(minAndroidSdk)) throw new Error("Missing Android version metadata");

const output = process.argv[2];
const notesFile = process.argv[3];
if (!output) throw new Error("Usage: generate-mobile-update.mjs <output-file> [release-notes-file]");
const versionName = packageJson.version;
const releaseNotes = notesFile ? (await readFile(resolve(notesFile), "utf8")).trim() : "";
const manifest = {
  versionName, versionCode, minAndroidSdk,
  apkUrl: `https://github.com/AR307/Mirrorcoding-APP/releases/download/v${versionName}/pi-mobile-v${versionName}.apk`,
  releaseNotes,
};
await writeFile(resolve(output), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

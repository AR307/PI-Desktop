import { execFile } from "node:child_process";
import type { symlink } from "node:fs";
import { join } from "node:path";

/** Read reparse-point attributes, not their targets, including dangling links. */
export async function storageLinkTypes(paths: string[]): Promise<Array<symlink.Type | undefined>> {
  if (process.platform !== "win32") return paths.map(() => undefined);
  if (!paths.length) return [];
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error("Windows system directory is unavailable.");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)",
    "$paths = ConvertFrom-Json ([Console]::In.ReadToEnd())",
    "$types = @(foreach ($path in $paths) { if (([IO.File]::GetAttributes($path) -band [IO.FileAttributes]::Directory) -ne 0) { 'junction' } else { 'file' } })",
    "ConvertTo-Json -InputObject $types -Compress",
  ].join("; ");
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(join(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.on("error", reject);
    child.stdin?.end(JSON.stringify(paths));
  });
  const types: unknown = JSON.parse(output);
  if (!Array.isArray(types) || types.length !== paths.length
    || !types.every((type): type is symlink.Type => type === "junction" || type === "file")) {
    throw new Error("Could not determine Windows storage link types.");
  }
  return types;
}

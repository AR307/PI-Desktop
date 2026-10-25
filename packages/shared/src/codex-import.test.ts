import { describe, expect, it } from "vitest";
import { validateCodexImportRequest } from "./codex-import-schema.js";

describe("Codex import IPC contracts", () => {
  it("accepts the selected import journey and explicit unbound directories", () => {
    expect(() => validateCodexImportRequest("scan", {})).not.toThrow();
    expect(() => validateCodexImportRequest("page", { scanId: "scan", offset: 240, limit: 40, archived: true })).not.toThrow();
    expect(() => validateCodexImportRequest("run", { scanId: "scan", runId: "batch", externalId: "session", projectPath: null, projectRoots: { old: null, other: "new" }, historyOnly: true })).not.toThrow();
    expect(() => validateCodexImportRequest("cancel", { scanId: "scan", runId: "batch", release: false })).not.toThrow();
    expect(() => validateCodexImportRequest("cancel", { scanId: "scan", release: true })).not.toThrow();
  });
  it("rejects malformed selections without interpreting them as default choices", () => {
    expect(() => validateCodexImportRequest("run", { scanId: "scan", externalId: "id" })).toThrow();
    expect(() => validateCodexImportRequest("cancel", { scanId: "scan" })).toThrow();
    expect(() => validateCodexImportRequest("scan", { directory: [] })).toThrow();
    expect(() => validateCodexImportRequest("page", { scanId: "scan", offset: -1 })).toThrow();
    expect(() => validateCodexImportRequest("run", { scanId: "scan", runId: "batch", externalId: "id", projectRoots: { old: true } })).toThrow();
  });
});

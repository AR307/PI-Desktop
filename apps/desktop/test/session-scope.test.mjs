import assert from "node:assert/strict";
import test from "node:test";
import { latestSessionInScope } from "../src/lib/session-scope.ts";

function session(id, overrides = {}) {
  return {
    id,
    projectPath: "/work",
    updatedAt: "2026-01-01T00:00:00.000Z",
    providerId: id,
    modelId: `${id}-model`,
    ...overrides,
  };
}

test("latestSessionInScope prefers the newest non-archived session in the project", () => {
  const older = session("older", { updatedAt: "2026-01-01T00:00:00.000Z" });
  const newer = session("newer", { updatedAt: "2026-01-02T00:00:00.000Z" });
  const otherProject = session("other", {
    projectPath: "/other",
    updatedAt: "2026-01-03T00:00:00.000Z",
  });
  const archived = session("archived", { updatedAt: "2026-01-04T00:00:00.000Z" });
  assert.equal(
    latestSessionInScope(
      [older, newer, otherProject, archived],
      "/work",
      { archived: { archived: true } },
    )?.id,
    "newer",
  );
  assert.equal(
    latestSessionInScope([older, newer], null, {})?.id,
    undefined,
  );
});

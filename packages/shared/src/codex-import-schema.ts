import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { SESSION_THINKING_LEVELS } from "./types/models.js";

const id = Type.String({ minLength: 1 });
const optionalString = Type.Optional(Type.String());
const nullablePath = Type.Union([Type.String(), Type.Null()]);
const thinking = Type.Union(SESSION_THINKING_LEVELS.map((level) => Type.Literal(level)));
export const CodexImportSchemas = {
  scan: Type.Object({ directory: optionalString }),
  page: Type.Object({ scanId: id, offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })), query: optionalString, projectId: optionalString, archived: Type.Optional(Type.Boolean()) }),
  run: Type.Object({ scanId: id, runId: id, externalId: id, projectPath: Type.Optional(nullablePath), projectRoots: Type.Optional(Type.Record(Type.String(), nullablePath)), targetGroupId: optionalString, providerId: optionalString, modelId: optionalString, thinkingLevel: Type.Optional(thinking), historyOnly: Type.Optional(Type.Boolean()), allowPartialContext: Type.Optional(Type.Boolean()) }),
  cancel: Type.Union([Type.Object({ scanId: id, release: Type.Literal(true) }), Type.Object({ scanId: id, runId: id, release: Type.Optional(Type.Literal(false)) })]),
};
export function validateCodexImportRequest<K extends keyof typeof CodexImportSchemas>(kind: K, value: unknown): asserts value is Static<(typeof CodexImportSchemas)[K]> {
  if (!Value.Check(CodexImportSchemas[kind], value)) throw new Error(`Invalid Codex import ${kind} request`);
}

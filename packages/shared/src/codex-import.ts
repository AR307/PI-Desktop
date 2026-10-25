/** Local, explicit Codex ingestion. Source credentials never cross this API. */
export type CodexImportProject = {
  id: string; name: string; roots: string[]; missingRoots: string[]; sessionIds: string[];
};
export type CodexImportCandidate = {
  id: string; title: string; cwd: string | null; projectId: string | null;
  createdAt: string; updatedAt: string; archived: boolean;
  model: string | null; reasoningEffort: string | null;
  directoryExists: boolean; imported: boolean;
};
export type CodexImportScan = {
  scanId: string; sourceDirectory: string; projects: CodexImportProject[];
  total: number; warnings: string[];
};
export type CodexImportPageRequest = {
  scanId: string; offset: number; limit: number; query?: string;
  projectId?: string; archived?: boolean;
};
export type CodexImportPage = { sessions: CodexImportCandidate[]; total: number };
export type CodexImportRequest = {
  scanId: string; runId: string; externalId: string;
  /** Null explicitly imports without binding a project directory. */
  projectPath?: string | null; targetGroupId?: string;
  projectRoots?: Record<string, string | null>;
  providerId?: string; modelId?: string; thinkingLevel?: string;
  historyOnly?: boolean;
  /** Explicit user consent to keep recoverable context despite listed gaps. */
  allowPartialContext?: boolean;
};
export type CodexImportResult = {
  externalId: string; sessionId?: string; archived?: boolean;
  status: "imported" | "skipped" | "needsConfirmation" | "cancelled";
  context: "restored" | "partial" | "historyOnly"; warnings: string[];
  availableContextMessages?: number;
};

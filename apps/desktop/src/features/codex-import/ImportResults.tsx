import { useTranslation } from "react-i18next";
import type { CodexImportResult } from "@pi-desktop/shared";
import { Button } from "../../components/ui";

export type ImportResult = CodexImportResult | { externalId: string; status: "failed"; warnings: string[] };
export type ImportChoice = "normal" | "partial";

function warningCategory(warning: string): string {
  if (/retained/i.test(warning)) return "retainedGap";
  if (/attachment|content part/i.test(warning)) return "attachmentGap";
  if (/base history|rollout is unavailable|history database|Projection watermark/i.test(warning)) return "historyGap";
  if (/unfinished|incomplete source|JSONL/i.test(warning)) return "unfinishedGap";
  if (/Unsupported|Unrecognized|Opaque|Rollback|compaction/i.test(warning)) return "unsupportedGap";
  return "otherGap";
}

export function ImportResults({ results, title, busy, retry, open }: {
  results: ImportResult[]; title: (id: string) => string; busy: boolean;
  retry: (ids: string[], choice: ImportChoice) => void; open: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  if (!results.length) return null;
  const confirmed = results.filter((r) => r.status === "imported" || r.status === "skipped").length;
  const needsReview = results.filter((r) => r.status === "needsConfirmation");
  const recoverable = needsReview.filter((r) => "availableContextMessages" in r && (r.availableContextMessages ?? 0) > 0);
  const failed = results.filter((r) => r.status === "failed");
  return <section className="codex-import-results" aria-label={t("codexImport.resultsTitle")} aria-live="polite">
    <div className="codex-import-controls"><strong>{t("codexImport.resultsSummary", { done: confirmed, review: needsReview.length, failed: failed.length })}</strong></div>
    {needsReview.length > 0 && <p>{t("codexImport.reviewHint")}</p>}
    {recoverable.length > 1 && <div className="codex-import-controls">
      <Button variant="primary" disabled={busy} onClick={() => retry(recoverable.map((r) => r.externalId), "partial")}>{t("codexImport.confirmPartialAll", { count: recoverable.length })}</Button>
    </div>}
    {results.map((result) => <article key={result.externalId} className="codex-import-result" data-status={result.status}>
      <strong>{title(result.externalId)}</strong>
      <span>{t("codexImport." + result.status)}{"context" in result && result.status === "imported" ? " · " + t("codexImport.context_" + result.context) : ""}</span>
      {result.status === "needsConfirmation" && !result.availableContextMessages && <p>{t("codexImport.noContext")}</p>}
      {result.status === "needsConfirmation" && (result.availableContextMessages ?? 0) > 0 && <div className="codex-import-controls">
        <Button variant="primary" disabled={busy} onClick={() => retry([result.externalId], "partial")}>{t("codexImport.confirmPartial")}</Button>
      </div>}
      {!!result.warnings.length && <ul className="codex-import-warning-list">{[...new Set(result.warnings.map(warningCategory))].map((category) => <li key={category}>{t("codexImport." + category)}</li>)}</ul>}
      {!!result.warnings.length && <details><summary>{t("codexImport.technicalDetails", { count: result.warnings.length })}</summary>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
      <div className="codex-import-controls">
        {result.status === "failed" && <Button disabled={busy} onClick={() => retry([result.externalId], "normal")}>{t("codexImport.retry")}</Button>}
        {"sessionId" in result && result.sessionId && <Button disabled={busy} onClick={() => open(result.sessionId!)}>{t("codexImport.open")}</Button>}
      </div>
    </article>)}
  </section>;
}

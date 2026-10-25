import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CodexImportCandidate, CodexImportScan, ProjectGroupRecord } from "@pi-desktop/shared";
import { Button, Checkbox, Input } from "../../components/ui";
import { SettingsMenuSelect } from "../../components/settings/SettingsMenuSelect";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { ImportDialog } from "./ImportDialog";
import { ImportResults, type ImportChoice, type ImportResult } from "./ImportResults";
import { useCodexImport } from "./store";

export function CodexImportWizard() {
  const open = useCodexImport((s) => s.open);
  return open ? <Wizard /> : null;
}
function Wizard() {
  const { t } = useTranslation();
  const close = useCodexImport((s) => s.close);
  const providers = useAppStore((s) => s.providers);
  const settings = useAppStore((s) => s.settings);
  const [source, setSource] = useState("");
  const [scan, setScan] = useState<CodexImportScan | null>(null);
  const [rows, setRows] = useState<CodexImportCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [archived, setArchived] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paths, setPaths] = useState<Record<string, string | null>>({});
  const [groups, setGroups] = useState<ProjectGroupRecord[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [rootPaths, setRootPaths] = useState<Record<string, string | null>>({});
  const [model, setModel] = useState(() => settings?.defaultProviderId && settings.defaultModelId ? JSON.stringify([settings.defaultProviderId, settings.defaultModelId]) : "");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [processing, setProcessing] = useState("");
  const resultAnchor = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancel = useRef(false);
  const runId = useRef("");
  const alive = useRef(true);
  const scanRef = useRef<CodexImportScan | null>(null);
  const generation = useRef(0);
  const candidates = useRef(new Map<string, CodexImportCandidate>());
  const [thinking, setThinking] = useState("");
  const modelPair: string[] = model ? JSON.parse(model) : [settings?.defaultProviderId, settings?.defaultModelId];
  const modelConfig = providers.find((p) => p.id === modelPair[0])?.models.find((m) => m.id === modelPair[1]);
  const modelOptions = providers.filter((p) => p.enabled).flatMap((p) => p.models.map((m) => ({ id: JSON.stringify([p.id, m.id]), label: `${p.name} / ${m.id}` })));

  const rescan = async (directory?: string) => {
    const current = ++generation.current;
    const previous = scanRef.current; scanRef.current = null; setScan(null);
    candidates.current.clear(); setPaths({}); setMapping({}); setRootPaths({});
    setLoading(true); setError(null); setRows([]); setSelected(new Set()); setResults([]);
    try {
      if (previous) await api.codexImportCancel(previous.scanId, true);
      const next = await api.codexImportScan(directory);
      if (!alive.current || current !== generation.current) { await api.codexImportCancel(next.scanId, true); return; }
      scanRef.current = next; setScan(next); setSource(next.sourceDirectory); setOffset(0); setProject("");
    } catch (e) { if (alive.current && current === generation.current) setError(String(e)); }
    finally { if (alive.current && current === generation.current) setLoading(false); }
  };
  useEffect(() => {
    alive.current = true;
    void rescan();
    void api.listProjectGroups().then((value) => { if (alive.current) setGroups(value.groups); }).catch((e: unknown) => { if (alive.current) setError(String(e)); });
    return () => { alive.current = false; generation.current++; cancel.current = true; if (scanRef.current) void api.codexImportCancel(scanRef.current.scanId, true).catch((e: unknown) => console.warn("Codex import release failed", String(e))); };
  }, []);
  useEffect(() => {
    if (!scan) return;
    let current = true; setLoading(true);
    void api.codexImportPage({ scanId: scan.scanId, offset, limit: 40, query, projectId: project || undefined, archived: archived === "all" ? undefined : archived === "archived" })
      .then((page) => { if (current) { for (const item of page.sessions) candidates.current.set(item.id, item); setRows(page.sessions); setTotal(page.total); } })
      .catch((e: unknown) => { if (current) setError(String(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [scan, offset, query, project, archived]);
  const select = (ids: string[], checked: boolean) => setSelected((old) => { const next = new Set(old); ids.forEach((id) => checked ? next.add(id) : next.delete(id)); return next; });
  const chooseSource = async () => { const path = await api.codexImportChoose(); if (path) { setSource(path); await rescan(path); } };
  const choosePath = async (id: string) => { const path = await api.codexImportChoose(); if (path) setPaths((old) => ({ ...old, [id]: path })); };
  const chooseRoot = async (root: string) => { const path = await api.codexImportChoose(); if (path) setRootPaths((old) => ({ ...old, [root]: path })); };
  useEffect(() => {
    if (!busy && results.length) {
      resultAnchor.current?.scrollIntoView({ block: "nearest" });
      resultAnchor.current?.focus({ preventScroll: true });
    }
  }, [busy, results]);
  const run = async (ids: string[], choice: ImportChoice = "normal") => {
    if (!scan || busy) return;
    runId.current = crypto.randomUUID();
    setBusy(true); setError(null); cancel.current = false; setProgress({ done: 0, total: ids.length });
    try {
      for (const id of ids) {
        if (cancel.current) break;
        setProcessing(candidates.current.get(id)?.title ?? id);
        const sourceProject = scan.projects.find((p) => p.sessionIds.includes(id));
        const target = sourceProject && mapping[sourceProject.id] ? groups.find((g) => g.id === mapping[sourceProject.id]) : undefined;
        const explicitPath = Object.prototype.hasOwnProperty.call(paths, id) ? paths[id] : undefined;
        const projectPath = explicitPath;
        try {
          const result = await api.codexImportRun({ scanId: scan.scanId, runId: runId.current, externalId: id, projectPath, projectRoots: rootPaths, targetGroupId: target?.id, providerId: modelPair[0], modelId: modelPair[1], thinkingLevel: thinking || modelConfig?.defaultThinkingLevel || "off", allowPartialContext: choice === "partial" });
          if (result.status === "imported" && result.archived && result.sessionId) useAppStore.getState().archiveSession(result.sessionId);
          setResults((old) => [...old.filter((r) => r.externalId !== id), result]);
          if (result.status === "imported" || result.status === "skipped") {
            const candidate = candidates.current.get(id);
            if (candidate) candidates.current.set(id, { ...candidate, imported: true });
            select([id], false);
            setRows((old) => old.map((row) => row.id === id ? { ...row, imported: true } : row));
          }
        } catch (e) { setResults((old) => [...old.filter((r) => r.externalId !== id), { externalId: id, status: "failed", warnings: [String(e)] }]); }
        setProgress((old) => ({ ...old, done: old.done + 1 }));
      }
      await useAppStore.getState().refreshSessions();
      const updated = await api.listProjectGroups(); setGroups(updated.groups);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const stop = async () => { cancel.current = true; if (scan) await api.codexImportCancel(scan.scanId, false, runId.current); };
  const openSession = async (sessionId: string) => { close(); await useAppStore.getState().selectSession(sessionId); useAppStore.getState().setPage("chat"); };
  const currentProject = scan?.projects.find((p) => p.id === project);
  const projectSelectable = currentProject?.sessionIds.filter((id) => !candidates.current.get(id)?.imported && !results.some((r) => r.externalId === id && (r.status === "imported" || r.status === "skipped"))) ?? [];
  const pending = [...selected].filter((id) => !results.some((r) => r.externalId === id && ["imported", "skipped", "needsConfirmation"].includes(r.status)));
  const needsReview = results.some((r) => r.status === "needsConfirmation");
  const selectable = rows.filter((r) => !r.imported);
  return <ImportDialog wide title={t("codexImport.action")} onClose={close} busy={busy}>
    <div className="codex-import-content">
    <p className="codex-import-warning">{t("codexImport.explanation")}</p>
    <div className="codex-import-controls"><Input aria-label={t("codexImport.source")} value={source} disabled={busy || loading} onChange={(e) => setSource(e.target.value)} placeholder={t("codexImport.source")} />
      <Button disabled={busy || loading} onClick={() => void chooseSource().catch((e: unknown) => setError(String(e)))}>{t("codexImport.browse")}</Button>
      <Button disabled={busy || loading} onClick={() => void rescan(source || undefined)}>{t("codexImport.scan")}</Button></div>
    <div className="codex-import-controls">
      <Input aria-label={t("codexImport.search")} placeholder={t("codexImport.search")} value={query} disabled={busy} onChange={(e) => { setQuery(e.target.value); setOffset(0); }} />
      <SettingsMenuSelect label={t("codexImport.project")} value={project} options={[{ id: "", label: t("codexImport.allProjects") }, ...(scan?.projects ?? []).map((p) => ({ id: p.id, label: p.name }))]} disabled={busy} onChange={(value) => { setProject(value); setOffset(0); }} />
      <SettingsMenuSelect label={t("codexImport.filter")} value={archived} options={["all", "active", "archived"].map((id) => ({ id, label: t(`codexImport.${id}`) }))} disabled={busy} onChange={(value) => { setArchived(value); setOffset(0); }} />
    </div>
    {currentProject && <Checkbox label={t("codexImport.selectProject", { count: projectSelectable.length })} checked={projectSelectable.length > 0 && projectSelectable.every((id) => selected.has(id))} disabled={busy || loading || !projectSelectable.length} onChange={(e) => select(projectSelectable, e.target.checked)} />}
    {currentProject && <details className="codex-import-options"><summary>{t("codexImport.advanced")}</summary><div className="codex-import-controls">
      <SettingsMenuSelect label={t("codexImport.targetProject")} value={mapping[project] ?? ""} options={[{ id: "", label: t("codexImport.keepProject") }, ...groups.map((g) => ({ id: g.id, label: g.name }))]} disabled={busy} onChange={(value) => setMapping((old) => ({ ...old, [project]: value }))} />
    </div><div className="codex-import-roots"><strong>{t("codexImport.sourceRoots")}</strong>{currentProject.roots.map((root) => <div key={root} className="codex-import-row">
      <small>{root}</small>
      <small>{Object.prototype.hasOwnProperty.call(rootPaths, root) ? rootPaths[root] ?? t("codexImport.leaveUnbound") : currentProject.missingRoots.includes(root) ? t("codexImport.missingDirectory") : t("codexImport.keepRoot")}</small>
      <div className="codex-import-controls"><Button variant="ghost" disabled={busy} onClick={() => void chooseRoot(root).catch((e: unknown) => setError(String(e)))}>{t("codexImport.rebind")}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setRootPaths((old) => ({ ...old, [root]: null }))}>{t("codexImport.leaveUnbound")}</Button></div>
    </div>)}</div></details>}
    <div className="codex-import-controls"><Checkbox label={t("codexImport.selectPage")} checked={selectable.length > 0 && selectable.every((r) => selected.has(r.id))} disabled={busy || loading || !selectable.length} onChange={(e) => select(selectable.map((r) => r.id), e.target.checked)} /><small>{t("codexImport.selectedCount", { count: selected.size })}</small></div>
    <div className="codex-import-list" aria-busy={loading}>
      {loading && <p role="status">{t("codexImport.scanning")}</p>}
      {!loading && !rows.length && <p>{t("codexImport.empty")}</p>}
      {rows.map((row) => <div key={row.id} className="codex-import-row">
        <Checkbox label={row.title} checked={selected.has(row.id)} disabled={busy || row.imported} onChange={(e) => select([row.id], e.target.checked)} />
        <small>{row.updatedAt} · {row.model ?? t("codexImport.unknownModel")} {row.reasoningEffort ?? ""} · {row.imported ? t("codexImport.skipped") : row.archived ? t("codexImport.archived") : t("codexImport.active")}</small>
        <small>{Object.prototype.hasOwnProperty.call(paths, row.id) ? paths[row.id] ?? t("codexImport.noDirectory") : row.cwd ?? t("codexImport.noDirectory")}</small>
        {selected.has(row.id) && <details className="codex-import-options"><summary>{t("codexImport.conversationOptions")}</summary><div className="codex-import-controls">
          {!row.directoryExists && <span className="codex-import-warning">{t("codexImport.missingDirectory")}</span>}
          <Button variant="ghost" disabled={busy} onClick={() => void choosePath(row.id).catch((e: unknown) => setError(String(e)))}>{t("codexImport.rebind")}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setPaths((old) => ({ ...old, [row.id]: null }))}>{t("codexImport.noDirectory")}</Button>
        </div></details>}
      </div>)}
    </div>
    <div className="codex-import-controls"><Button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - 40))}>{t("codexImport.previous")}</Button>
      <span>{Math.min(offset + rows.length, total)} / {total}</span><Button disabled={busy || offset + 40 >= total} onClick={() => setOffset(offset + 40)}>{t("codexImport.next")}</Button>
      <SettingsMenuSelect label={t("codexImport.model")} value={model} options={[{ id: "", label: t("codexImport.defaultModel") }, ...modelOptions]} disabled={busy} onChange={(value) => { setModel(value); setThinking(""); }} />
      {!!modelConfig?.thinkingLevels.length && <SettingsMenuSelect label={t("codexImport.thinking")} value={thinking || modelConfig.defaultThinkingLevel || "off"} options={modelConfig.thinkingLevels.map((id) => ({ id, label: id }))} disabled={busy} onChange={setThinking} />}
    </div>
    {error && <p role="alert">{error}</p>}
    {!!scan?.warnings.length && <details><summary>{t("codexImport.technicalDetails", { count: scan.warnings.length })}</summary>{scan.warnings.map((warning) => <p key={warning} className="codex-import-warning">{warning}</p>)}</details>}
    <div ref={resultAnchor} tabIndex={-1}><ImportResults results={results} title={(id) => candidates.current.get(id)?.title ?? id} busy={busy} retry={(ids, choice) => void run(ids, choice)} open={(id) => void openSession(id).catch((e: unknown) => setError(String(e)))} /></div>
    </div>
    <footer>{busy ? <><span role="status">{t("codexImport.processing", { ...progress, title: processing })}</span><Button onClick={() => void stop().catch((e: unknown) => setError(String(e)))}>{t("common.cancel")}</Button></> : <>
      {needsReview && <Button onClick={() => { resultAnchor.current?.scrollIntoView({ block: "start" }); resultAnchor.current?.focus({ preventScroll: true }); }}>{t("codexImport.reviewResults")}</Button>}
      <Button variant="ghost" onClick={close}>{t("common.close")}</Button>
      <Button variant="primary" disabled={!scan || loading || !pending.length} onClick={() => void run(pending)}>{t("codexImport.importSelected", { count: pending.length })}</Button>
    </>}</footer>
  </ImportDialog>;
}

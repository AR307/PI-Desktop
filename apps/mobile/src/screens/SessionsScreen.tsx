import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Folder, Image as ImageIcon, ListChecks, MessageSquare, Monitor, Plus, RefreshCw, Search, Sparkles, Target, WifiOff, X } from "lucide-react";
import type { MobileSession } from "@pi-desktop/shared";
import type { MobileController, MobileView } from "../state/controller";
import type { DesktopDirectory } from "../state/directories";
import { needsUser, relativeTime, sessionStatus, type SessionStatusKind } from "../state/labels";
import { Screen } from "../ui/Screen";
import { EmptyState, SkeletonRows, StatusBadge } from "../ui/controls";
import { BackgroundDeliveryNotice } from "../features/notifications/BackgroundDeliveryNotice";

type Entry = { directory: DesktopDirectory; session: MobileSession; status: SessionStatusKind };
const modeIcon = { agent: Sparkles, plan: ListChecks, goal: Target, image: ImageIcon } as const;

export const SessionRow = memo(function SessionRow({ entry, showComputer, onOpen, locale }: { entry: Entry; showComputer: boolean; onOpen(desktopId: string, sessionId: string): void; locale: string }) {
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const { directory, session, status } = entry;
  const Icon = modeIcon[session.taskMode] ?? MessageSquare;
  const project = directory.projects.find((candidate) => candidate.id === session.projectId)?.label;
  const meta = [showComputer ? directory.device.name : undefined, project, session.modelId].filter(Boolean).join(" · ");
  const pill = status === "idle" ? undefined : t(status === "approval" ? "statusApproval" : status === "plan" ? "statusPlan" : status === "input" ? "statusInput" : status === "running" ? "statusRunning" : status === "queued" ? "statusQueued" : "statusFailed");
  return <button type="button" className={`session-card ${needsUser(status) ? "attention" : ""} ${directory.device.online ? "" : "dimmed"}`} onClick={() => onOpen(directory.desktopDeviceId, session.id)}>
    <span className="session-avatar"><Icon size={19}/>{status !== "idle" && <StatusBadge status={status}/>}</span>
    <span className="session-main">
      <span className="session-line"><span className="session-title">{session.title || t("untitledSession")}</span><span className="session-time">{relativeTime(session.updatedAt, locale)}</span></span>
      <span className="session-meta"><span>{meta || " "}</span>{session.archived && <Archive size={13}/>}{pill && <span className={`status-pill ${status}`}>{pill}</span>}</span>
    </span>
  </button>;
});

export function SessionsScreen({ controller, view, onOpen, onPair }: { controller: MobileController; view: MobileView; onOpen(desktopId: string, sessionId: string): void; onPair(): void }) {
  const { t, i18n } = useTranslation("translation", { keyPrefix: "mobile" });
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const selected = filter === "all" ? undefined : view.directories.find((row) => row.desktopDeviceId === filter);
  const scope = selected ? [selected] : view.directories;
  const needle = query.trim().toLowerCase();
  const entries = useMemo(() => scope.flatMap((directory) => directory.sessions.map((session) => ({ directory, session, status: sessionStatus(session) })))
    .filter(({ session, directory }) => {
      if (session.archived && !(selected && archived) && !needle) return false;
      if (!needle) return true;
      const project = directory.projects.find((candidate) => candidate.id === session.projectId)?.label ?? "";
      return `${session.title} ${project} ${session.modelId ?? ""} ${directory.device.name}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => (b.session.updatedAt ?? "").localeCompare(a.session.updatedAt ?? "")), [scope, selected, archived, needle]);
  const refresh = () => void controller.action(async () => { await controller.refreshGrants(); });
  const locale = i18n.language;
  const showComputer = !selected && view.directories.length > 1;
  const row = (entry: Entry) => <SessionRow key={`${entry.directory.desktopDeviceId}:${entry.session.id}`} entry={entry} showComputer={showComputer} onOpen={onOpen} locale={locale}/>;

  let body;
  if (view.loading && !view.directories.length) body = <SkeletonRows count={5}/>;
  else if (!view.directories.length) body = <EmptyState icon={<Monitor size={28}/>} title={t("empty")} action={<button type="button" className="button-primary" onClick={onPair}><Plus size={18}/>{t("pair")}</button>}>{t("emptyHint")}</EmptyState>;
  else if (needle) body = entries.length ? <div className="session-list">{entries.map(row)}</div> : <EmptyState icon={<Search size={26}/>} title={t("noSearchResults", { query })}/>;
  else if (selected) {
    const groups = [...selected.projects, { id: "", label: t("ungrouped"), archived: false }];
    body = <>{groups.filter((project) => archived || !project.archived).map((project) => {
      const sessions = entries.filter((entry) => (entry.session.projectId ?? "") === project.id);
      if (!sessions.length && !project.id) return null;
      return <section key={project.id || "ungrouped"} className="project-section">
        <h2 className="project-heading"><Folder size={14}/>{project.label}</h2>
        {sessions.length ? <div className="session-list">{sessions.map(row)}</div> : <p className="project-empty">{t("noConversations")}</p>}
      </section>;
    })}{!selected.projects.length && !entries.length && <EmptyState icon={<MessageSquare size={26}/>} title={t(selected.device.online ? "noConversations" : "offlineHint")}/>}</>;
  } else {
    const urgent = entries.filter((entry) => needsUser(entry.status));
    const rest = entries.filter((entry) => !needsUser(entry.status));
    body = <>
      {urgent.length > 0 && <section className="section"><div className="section-header"><span>{t("needsAttention")}</span></div><div className="session-list stagger">{urgent.map(row)}</div></section>}
      {rest.length > 0 && <section className="section"><div className="section-header"><span>{t("recent")}</span></div><div className="session-list stagger">{rest.map(row)}</div></section>}
      {!entries.length && <EmptyState icon={<MessageSquare size={26}/>} title={t("noConversations")}/>}
    </>;
  }

  const computersOffline = scope.length > 0 && scope.every((directory) => !directory.device.online);
  return <Screen title={t("sessionsTitle")} actions={<>
    <button type="button" className="icon-button" aria-label={t("refresh")} onClick={refresh}><RefreshCw size={19}/></button>
    {view.directories.length > 0 && <button type="button" className="icon-button" aria-label={t("pair")} onClick={onPair}><Plus size={21}/></button>}
  </>}>
    {view.offline
      ? <div className="banner warning" role="status"><WifiOff size={17} className="banner-icon"/><span className="banner-body"><span>{t("offlineBanner")}</span></span></div>
      : computersOffline && <div className="banner" role="status"><Monitor size={17} className="banner-icon"/><span className="banner-body"><span>{t("DESKTOP_OFFLINE")}</span></span></div>}
    {/* Only evidence of held-back deliveries interrupts the list; first-run guidance lives in Activity and Me. */}
    <BackgroundDeliveryNotice controller={controller} view={view} variants={["delayed"]}/>
    {view.directories.length > 0 && <>
      <div className="search-field">
        <Search size={17}/>
        <input type="search" value={query} placeholder={t("searchSessions")} aria-label={t("searchSessions")} onChange={(event) => setQuery(event.target.value)}/>
        {query && <button type="button" className="icon-button" aria-label={t("clearSearch")} onClick={() => setQuery("")}><X size={16}/></button>}
      </div>
      <div className="chip-row" role="group" aria-label={t("computers")}>
        <button type="button" className="chip" aria-pressed={!selected} onClick={() => setFilter("all")}>{t("allComputers")}</button>
        {view.directories.map((directory) => <button type="button" key={directory.desktopDeviceId} className="chip grant-open" aria-pressed={filter === directory.desktopDeviceId} onClick={() => setFilter(directory.desktopDeviceId)}>
          <span className={`dot ${directory.connection === "connected" ? "online" : ""}`}/>{directory.device.name}
        </button>)}
        {selected && <button type="button" className="chip" aria-pressed={archived} onClick={() => setArchived(!archived)}><Archive size={14}/>{t(archived ? "hideArchived" : "showArchived")}</button>}
      </div>
    </>}
    {body}
  </Screen>;
}

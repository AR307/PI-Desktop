import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { CodexImportDismissDialog, CodexImportSettings } from "../../apps/desktop/src/features/codex-import/CodexImportCard";
import { CodexImportWizard } from "../../apps/desktop/src/features/codex-import/CodexImportWizard";
import { useCodexImport } from "../../apps/desktop/src/features/codex-import/store";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { Sidebar } from "../../apps/desktop/src/components/Sidebar";
import "../../apps/desktop/src/styles/tokens.css";
import "../../apps/desktop/src/styles/base.css";
import "../../apps/desktop/src/styles/ui-kit.css";
import "../../apps/desktop/src/styles/settings.css";
import "../../apps/desktop/src/styles/chrome.css";
import "../../apps/desktop/src/styles/sidebar-threads.css";
import "../../apps/desktop/src/styles/theme-overrides.css";
import "../../apps/desktop/src/styles/overlays.css";

declare global { var codexImportProbe: (stage: string) => Promise<unknown>; }
const assert = (condition: unknown, text: string) => { if (!condition) throw new Error(text); };
const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function until(test: () => boolean, label: string) {
  const end = performance.now() + 10000;
  while (!test() && performance.now() < end) await painted();
  assert(test(), label);
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
const click = (element: HTMLElement | undefined | null) => { assert(element, "Click target missing"); element!.focus(); flushSync(() => element!.click()); };
const card = () => document.querySelector<HTMLElement>('[data-testid="codex-import-card"]');
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

globalThis.codexImportProbe = async (stage) => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh-CN", resources: { "zh-CN": { translation: catalogs["zh-CN"] } } });
  assert(i18n.t("codexImport.title") === "导入 Codex", "feature translations are not registered");
  useAppStore.setState({ providers: [], sessions: Array.from({ length: 80 }, (_, i) => ({ id: `visual-${i}`, title: `项目 / 对话 ${i}`, createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z", projectPath: null, providerId: null, modelId: null, thinkingLevel: "off", mode: "agent", permissionMode: "inherit" })) });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(<I18nextProvider i18n={i18n}>
    <div style={{ width: 260, height: 560, display: "flex" }} data-testid="sidebar">
      <Sidebar sidebarWidth={260} sidebarToggleShortcut="Ctrl+B" onToggleSidebar={() => {}} onWidthChange={() => {}} onWidthCommit={() => {}} onResizeCollapse={() => {}} />
    </div><CodexImportSettings /><CodexImportDismissDialog /><CodexImportWizard />
  </I18nextProvider>));
  await until(() => useCodexImport.getState().ready, "hint state did not load");
  if (stage === "card") { assert(card(), "card not visible for visual review"); return { ok: true }; }
  if (stage === "card-open") {
    click(button(i18n.t("codexImport.action")));
    await until(() => document.querySelectorAll(".codex-import-row").length === 2, "sidebar button did not open shared wizard");
    click(button(i18n.t("codexImport.project")));
    const projects = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].filter((b) => b.textContent?.trim() === "Imported workspace");
    assert(projects.length === 1, "migrated source project appears twice");
    click(projects[0]);
    await until(() => document.querySelectorAll('.codex-import-list .codex-import-row').length === 2 && document.querySelector('.codex-import-list')?.getAttribute('aria-busy') === 'false', "project filter lost assigned conversations");
    const input = document.querySelector<HTMLInputElement>(`input[aria-label="${i18n.t("codexImport.search")}"]`)!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    input.focus();
    flushSync(() => { setValue.call(input, "Imported first"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await until(() => document.querySelectorAll('.codex-import-list .codex-import-row').length === 1 && document.querySelector('.codex-import-list')?.getAttribute('aria-busy') === 'false', "display-name search failed inside migrated project");
    assert(document.querySelector('.codex-import-list')?.textContent?.includes("Imported first"), "search returned the wrong conversation");
    return { ok: true, scenarios: ["sidebar-shared-wizard", "migrated-project-filter", "conversation-display-name-search"] };
  }
  if (stage === "dismiss") { click(button(i18n.t("codexImport.dismissTitle"))); return { ok: true }; }
  if (stage === "bulk-review") {
    click(button(i18n.t("codexImport.settingsAction")));
    await until(() => document.querySelectorAll(".codex-import-list .codex-import-row").length === 5, "batch fixtures missing");
    for (const row of document.querySelectorAll<HTMLElement>(".codex-import-list .codex-import-row")) {
      if (row.textContent?.includes("Review ")) click(row.querySelector<HTMLInputElement>("input[type=checkbox]"));
    }
    click(button(i18n.t("codexImport.importSelected", { count: 3 })));
    await until(() => document.querySelectorAll('.codex-import-result[data-status="needsConfirmation"]').length === 3 && !button(i18n.t("codexImport.confirmPartialAll", { count: 2 }))?.disabled, "batch review unavailable");
    assert(document.querySelector(".codex-import-results")?.textContent?.includes(i18n.t("codexImport.noContext")), "missing context lacks a clear explanation");
    assert(document.querySelectorAll(".codex-import-result details[open]").length === 0, "batch warning details expanded");
    const actions = [...document.querySelectorAll<HTMLButtonElement>(".codex-import-results button")].map((action) => action.textContent?.trim());
    assert(actions.length === 3 && actions.every((label) => label === i18n.t("codexImport.confirmPartial") || label === i18n.t("codexImport.confirmPartialAll", { count: 2 })), "review offers actions other than continuation import");
    click(button(i18n.t("codexImport.confirmPartialAll", { count: 2 })));
    await until(() => document.querySelectorAll('.codex-import-result[data-status="imported"]').length === 2 && !button(i18n.t("common.close"))?.disabled, "bulk partial confirmation failed");
    const unavailable = document.querySelector('.codex-import-result[data-status="needsConfirmation"]');
    assert(unavailable?.textContent?.includes("Review missing-context"), "unrecoverable conversation was silently imported");
    assert(unavailable?.querySelectorAll("button").length === 0, "unrecoverable conversation offers an empty-context import");
    return {ok:true,scenarios:["multi-item-review","bulk-partial-consent","missing-context-explanation","no-history-only-actions","no-empty-context-import"]};
  }
  if (stage === "partial" || stage === "partial-review") {
    click(button(i18n.t("codexImport.settingsAction")));
    await until(() => document.querySelectorAll(".codex-import-list .codex-import-row").length === 2, "partial source list missing");
    const row = [...document.querySelectorAll<HTMLElement>(".codex-import-list .codex-import-row")].find((r) => r.textContent?.includes("Imported second"))!;
    assert(row.getBoundingClientRect().height >= 60, "conversation row is compressed");
    click(row.querySelector<HTMLInputElement>("input[type=checkbox]"));
    assert(!row.querySelector("details")?.open, "directory controls should start collapsed");
    click(button(i18n.t("codexImport.importSelected", { count: 1 })));
    await until(() => !!button(i18n.t("codexImport.confirmPartial")) && !button(i18n.t("codexImport.confirmPartial"))!.disabled, "partial confirmation unavailable");
    const action = button(i18n.t("codexImport.confirmPartial"))!;
    assert(document.querySelectorAll(".codex-import-result button").length === 1, "review should offer only the continuation import action");
    const bounds = action.getBoundingClientRect();
    assert(bounds.height > 0 && bounds.top >= 0 && bounds.bottom < innerHeight, "recovery action is clipped");
    assert(!document.querySelector<HTMLDetailsElement>(".codex-import-result details")?.open, "technical warnings expanded by default");
    assert(button(i18n.t("codexImport.importSelected", { count: 0 }))?.disabled, "pending review permits repeat normal import");
    if (stage === "partial-review") return { ok: true, scenarios: ["single-continuation-action", "review-visual"] };
    click(action);
    await until(() => !!document.querySelector('.codex-import-result[data-status="imported"]') && !button(i18n.t("common.close"))?.disabled, "partial import failed");
    assert(document.querySelector(".codex-import-result")?.textContent?.includes(i18n.t("codexImport.context_partial")), "partial recovery is presented as complete");
    assert(!row.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked, "completed selection not cleared");
    return {ok:true, scenarios:["partial-review", "recovery-action-visible", "collapsed-details", "native-partial-import", "selection-cleared"]};
  }
  if (stage === "reload-hidden" || stage === "restart-hidden") {
    assert(!card(), "hidden card returned");
    if (stage === "reload-hidden") return { ok: true };
    click(document.querySelector<HTMLButtonElement>('[role="switch"]'));
    await until(() => !!card(), "settings did not restore hint");
  } else if (stage === "restart-visible") {
    assert(card(), "temporary dismissal survived app restart");
  } else {
    assert(card(), "first run hint missing");
    const rect = card()!.getBoundingClientRect();
    const list = document.querySelector<HTMLElement>('.sidebar-body')!;
    assert(rect.bottom <= list.getBoundingClientRect().top, "hint overlaps history");
    list.scrollTop = 500; await painted(); assert(card()!.getBoundingClientRect().top === rect.top, "hint scrolls with list");
    click(button(i18n.t("codexImport.dismissTitle"))); assert(card(), "card hidden before confirmation");
    click(button(i18n.t("common.cancel"))); assert(card() && !dialog(), "cancel changed hint state");
    assert(document.activeElement === button(i18n.t("codexImport.dismissTitle")), "cancel did not restore keyboard focus");
    click(button(i18n.t("codexImport.dismissTitle")));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await painted();
    assert(card() && !dialog(), "Escape failed to cancel");
    click(button(i18n.t("codexImport.dismissTitle"))); click(button(i18n.t("codexImport.dismissOnce")));
    await until(() => !card(), "run dismissal failed");
    useAppStore.setState({ page: "settings" }); await painted(); assert(!card(), "navigation reset dismissal");
    return { ok: true, scenarios: ["layout", "cancel", "escape", "dismiss-once", "navigation"] };
  }
  click(button(i18n.t("codexImport.dismissTitle"))); click(button(i18n.t("codexImport.dismissForever")));
  await until(() => !card(), "permanent dismissal failed");
  if (stage === "restart-visible") return { ok: true };
  click(button(i18n.t("codexImport.settingsAction")));
  await until(() => document.querySelectorAll(".codex-import-row").length === 2, "real Host scan did not populate wizard");
  assert(!document.querySelector<HTMLInputElement>('.codex-import-row input[type="checkbox"]')?.checked, "scan auto selected history");
  click(document.querySelector<HTMLInputElement>('.codex-import-row input[type="checkbox"]'));
  click(button(i18n.t("codexImport.importSelected", { count: 1 })));
  await until(() => !!document.querySelector('.codex-import-result[data-status="imported"]'), "selected history failed to import");
  await until(() => !!button(i18n.t("codexImport.importSelected", { count: 0 })) && !button(i18n.t("common.close"))?.disabled, "import did not finish refreshing");
  assert(useAppStore.getState().sessionMeta["import-codex-first"]?.archived, "source archive status did not reach native sidebar preferences");
  assert(!card(), "import unexpectedly showed hidden card");
  return { ok: true, scenarios: ["permanent-hide", "settings-reenable", "shared-wizard", "real-host-import"] };
};

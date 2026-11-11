import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { ComposerModelList } from "./ComposerModelList";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import {
  IconBot,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconImage,
  IconZap,
} from "../../../components/icons";
import { SettingsToggle, TooltipButton } from "../../../components/ui";
import type { useComposerModelMenu } from "./hooks/useComposerModelMenu";
import { ThinkingLevelSlider } from "./ThinkingLevelSlider";
import { ComposerClaudeCache } from "./ComposerClaudeCache";

type ModelMenuController = ReturnType<typeof useComposerModelMenu>;

export type ComposerModelPickerProps = {
  t: TFunction;
  controller: ModelMenuController;
  modelLabel: string;
  thinkingLabel: string;
  thinkingLevel: string;
  /** The selected model asks for OpenAI's priority tier (ADR 0334). */
  fastMode?: boolean;
  selectedProviderId?: string;
  selectedModelId?: string;
  controlsBlocked: boolean;
  onCloseOtherMenus: () => void;
  rootActions?: ReactNode;
  /** Opens the Models settings destination; omitted where Settings is the host. */
  onOpenModelSettings?: () => void;
};

/** Model/reasoning picker with its keyboard and focus contract intact. */
export function ComposerModelPicker({
  t,
  controller,
  modelLabel,
  thinkingLabel: nativeThinkingLabel,
  thinkingLevel: nativeThinkingLevel,
  fastMode = false,
  selectedProviderId,
  selectedModelId,
  controlsBlocked,
  onCloseOtherMenus,
  rootActions,
  onOpenModelSettings,
}: ComposerModelPickerProps) {
  const thinkingLabel = controller.ultra ? t("ultra.label") : nativeThinkingLabel;
  const thinkingLevel = controller.ultra ? "ultra" : nativeThinkingLevel;
  const {
    task,
    view, showView, rootMenuRef,
    open,
    setOpen,
    sections,
    activeSection,
    sectionStep,
    selectSection,
    showSectionRail,
    paneRows,
    searching,
    query,
    setQuery,
    modelHighlight,
    setModelHighlight,
    modelSearchRef,
    modelListRef,
    groupListRef,
    pendingMirrorModel,
    mirrorGroups,
    mirrorCodingSelected,
    modelGroups,
    recentEntries,
    thinkingMenuLevels,
    selectModel,
    commitThinkingLevel,
    onMenuKeyDown,
  } = controller;
  const imageMode = task === "image";
  const fastHint = !imageMode && controller.fast ? ` · ${t("mirrorCoding.fastRequested")}` : "";
  const fastSuffix = fastMode ? ` · ${t("chat.fastModeBadge")}` : "";

  return (
    <AnchoredMenu
      className="composer-model-thinking"
      open={open}
      onClose={() => setOpen(false)}
      menuClassName={`composer-model-menu composer-model-thinking-menu ${showSectionRail ? "has-rail" : ""}`}
      label={imageMode ? t("images.mode") : `${t("chat.model")} ${t("chat.reasoningLevel")}`}
      role="menu"
      align="end"
      side="top"
      initialFocus="input"
      onMenuKeyDown={onMenuKeyDown}
      trigger={(ref) => (
        <TooltipButton
          ref={ref}
          type="button"
          className={`icon-btn composer-model-thinking-chip ${open ? "active" : ""}`}
          tooltip={imageMode ? `${t("images.mode")}: ${modelLabel}` : `${modelLabel} · ${t("chat.reasoningLevel")}: ${thinkingLabel}${fastHint}${fastSuffix}`}
          ariaLabel={imageMode ? `${t("images.mode")}: ${modelLabel}` : `${t("chat.model")}: ${modelLabel}. ${t("chat.reasoningLevel")}: ${thinkingLabel}${fastHint}${fastSuffix}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={controlsBlocked}
          onClick={() => {
            onCloseOtherMenus();
            if (!open) {
              setQuery("");
              setModelHighlight(-1);
            }
            setOpen((current) => !current);
          }}
        >
          <span className="composer-model-thinking-icon" aria-hidden="true">
            {imageMode ? <IconImage size={14} /> : <IconBot size={14} />}
          </span>
          <span className="composer-model-thinking-model">{modelLabel}</span>
          {!imageMode && thinkingLevel !== "off" ? (
            <span className="composer-model-thinking-level">{thinkingLabel}</span>
          ) : null}
          {!imageMode && controller.fast && <IconZap size={12} fill="currentColor" strokeWidth={0} className="composer-model-fast-icon" aria-hidden="true" />}
          {fastMode ? (
            <span className="composer-model-thinking-fast" aria-hidden="true">
              <IconZap size={12} />
            </span>
          ) : null}
          <IconChevronDown size={12} aria-hidden="true" className="composer-model-thinking-chevron" />
        </TooltipButton>
      )}
    >
      <div className="composer-menu-root" ref={rootMenuRef} onMouseMove={() => setModelHighlight(-1)} onMouseLeave={() => setModelHighlight(-1)}>
        {rootActions}
          {!imageMode && <div className="composer-fast-setting">
            <div className="composer-menu-entry"><span className="composer-menu-entry-label">{t("mirrorCoding.fast")}</span>
              <SettingsToggle checked={controller.fast} label={t("mirrorCoding.fast")} disabled={!controller.fastAvailable && !controller.fast} busy={controller.fastBusy} onChange={() => void controller.toggleFast()} />
            </div>
            <small role="status">{t(controller.fastAvailable ? (controller.fast ? "mirrorCoding.fastRequested" : "mirrorCoding.fastHint") : "mirrorCoding.fastUnavailable")}</small>
          </div>}
        {view === "group" ? <>
          <button type="button" className="composer-menu-back" role="menuitem" onClick={() => showView("root")}><IconChevronLeft size={14} /><span>{pendingMirrorModel}</span></button>
            <div className="composer-model-list" ref={groupListRef} aria-label={t("images.chooseModel")}>
              {mirrorGroups.map(({ provider }) => {
                const group = provider.mirrorCoding!;
                const binding = provider.models.find((entry) => entry.id === pendingMirrorModel);
                const active = provider.id === selectedProviderId && pendingMirrorModel === selectedModelId;
                const imageCapability = group.imageModels?.[pendingMirrorModel ?? ""];
                return (
                  <button
                    key={provider.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={`composer-plus-item mirrorcoding-group-option ${active ? "active" : ""}`}
                    onClick={() => pendingMirrorModel && void selectModel(provider, pendingMirrorModel, true)}
                  >
                    <strong className="mirrorcoding-group-name">{group.groupName}</strong>
                    <span className="mirrorcoding-group-rate">
                      {group.dynamicBilling || group.ratio == null ? t("mirrorCoding.dynamic") : String(group.ratio) + "×"}
                    </span>
                    {group.description ? <span className="mirrorcoding-group-detail">{group.description}</span> : null}
                    <span className="mirrorcoding-group-detail">
                      {imageMode
                        ? t(imageCapability?.reference_path ? "images.referencesSupported" : "images.noReferences")
                        : binding?.thinkingLevels.join(" / ") || "off"}
                    </span>
                  </button>
                );
              })}
              {mirrorGroups.length === 0 ? <p role="status">{t("mirrorCoding.model_or_group_unavailable")}</p> : null}
            </div>
        </> : <ComposerModelList

          t={t} query={query} setQuery={setQuery}
          modelSearchRef={modelSearchRef} modelListRef={modelListRef}
          modelGroups={modelGroups} modelHighlight={modelHighlight}
          recentEntries={recentEntries} sections={sections}
          activeSection={activeSection} sectionStep={sectionStep} selectSection={selectSection}
          showSectionRail={showSectionRail} searching={searching} paneRows={paneRows}
          setModelHighlight={setModelHighlight} selectModel={selectModel}
          selectedProviderId={selectedProviderId} selectedModelId={selectedModelId}
          accountSelected={mirrorCodingSelected}
          onOpenModelSettings={onOpenModelSettings ? () => {
            setOpen(false);
            onOpenModelSettings();
          } : undefined}
        />}
        {!imageMode && thinkingMenuLevels.length > 1 ? (
          <div className="composer-model-reasoning">
            <span className="composer-model-reasoning-label" aria-hidden="true">
              {t("chat.reasoningShort")}
            </span>
            <ThinkingLevelSlider
              key={`${selectedProviderId}:${selectedModelId}:${thinkingMenuLevels.join("|")}`}
              levels={thinkingMenuLevels}
              level={thinkingLevel}
              label={t("chat.reasoningLevel")}
              commit={commitThinkingLevel}
            />
          </div>
        ) : null}
        {!imageMode && controller.ultra && <small role="status">{t(controller.ultraAvailable ? "ultra.hint" : "ultra.unavailable", { reasoning: controller.ultraReasoning })}</small>}
        {!imageMode && <ComposerClaudeCache key={`${selectedProviderId}:${selectedModelId}`} providerId={selectedProviderId} modelId={selectedModelId} disabled={controlsBlocked} />}
      </div>
    </AnchoredMenu>
  );
}

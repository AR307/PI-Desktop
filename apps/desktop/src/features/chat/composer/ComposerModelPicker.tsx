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

type ModelMenuController = ReturnType<typeof useComposerModelMenu>;

export type ComposerModelPickerProps = {
  t: TFunction;
  controller: ModelMenuController;
  modelLabel: string;
  thinkingLabel: string;
  thinkingLevel: string;
  selectedProviderId?: string;
  selectedModelId?: string;
  controlsBlocked: boolean;
  onCloseOtherMenus: () => void;
  rootActions?: ReactNode;
};

/** Model/reasoning picker with its keyboard and focus contract intact. */
export function ComposerModelPicker({
  t,
  controller,
  modelLabel,
  thinkingLabel: nativeThinkingLabel,
  thinkingLevel: nativeThinkingLevel,
  selectedProviderId,
  selectedModelId,
  controlsBlocked,
  onCloseOtherMenus,
  rootActions,
}: ComposerModelPickerProps) {
  const thinkingLabel = controller.ultra ? t("ultra.label") : nativeThinkingLabel;
  const thinkingLevel = controller.ultra ? "ultra" : nativeThinkingLevel;
  const {
    task,
    open,
    setOpen,
    view,
    query,
    setQuery,
    modelHighlight,
    setModelHighlight,
    rootMenuRef,
    modelSearchRef,
    modelListRef,
    groupListRef,
    pendingMirrorModel,
    mirrorGroups,
    mirrorCodingSelected,
    modelGroups,
    thinkingMenuLevels,
    showView,
    selectModel,
    commitThinkingLevel,
    onMenuKeyDown,
  } = controller;
  const imageMode = task === "image";
  const fastHint = !imageMode && controller.fast ? ` · ${t("mirrorCoding.fastRequested")}` : "";

  return (
    <AnchoredMenu
      className="composer-model-thinking"
      open={open}
      onClose={() => setOpen(false)}
      menuClassName="composer-model-menu composer-model-thinking-menu"
      label={imageMode ? t("images.mode") : `${t("chat.model")} ${t("chat.reasoningLevel")}`}
      role="menu"
      align="end"
      side="top"
      initialFocus="none"
      onMenuKeyDown={onMenuKeyDown}
      trigger={(ref) => (
        <TooltipButton
          ref={ref}
          type="button"
          className={`icon-btn composer-model-thinking-chip ${open ? "active" : ""}`}
          tooltip={imageMode ? `${t("images.mode")}: ${modelLabel}` : `${modelLabel} · ${t("chat.reasoningLevel")}: ${thinkingLabel}${fastHint}`}
          ariaLabel={imageMode ? `${t("images.mode")}: ${modelLabel}` : `${t("chat.model")}: ${modelLabel}. ${t("chat.reasoningLevel")}: ${thinkingLabel}${fastHint}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={controlsBlocked}
          onClick={() => {
            onCloseOtherMenus();
            if (!open) {
              showView("root");
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
            <>
              <span className="composer-model-thinking-dot" aria-hidden="true">·</span>
              <span className="composer-model-thinking-level">{thinkingLabel}</span>
            </>
          ) : null}
          {!imageMode && controller.fast && <IconZap size={12} fill="currentColor" strokeWidth={0} className="composer-model-fast-icon" aria-hidden="true" />}
          <IconChevronDown size={12} aria-hidden="true" className="composer-model-thinking-chevron" />
        </TooltipButton>
      )}
    >
      {view === "root" ? (
        <div className="composer-menu-root" ref={rootMenuRef}>
          {rootActions}
          {!imageMode && <div className="composer-fast-setting">
            <div className="composer-menu-entry"><span className="composer-menu-entry-label">{t("mirrorCoding.fast")}</span>
              <SettingsToggle checked={controller.fast} label={t("mirrorCoding.fast")} disabled={!controller.fastAvailable && !controller.fast} busy={controller.fastBusy} onChange={() => void controller.toggleFast()} />
            </div>
            <small role="status">{t(controller.fastAvailable ? (controller.fast ? "mirrorCoding.fastRequested" : "mirrorCoding.fastHint") : "mirrorCoding.fastUnavailable")}</small>
          </div>}
          <button
            type="button"
            className="composer-menu-entry"
            role="menuitem"
            aria-haspopup="menu"
            onClick={() => showView("model")}
          >
            {imageMode ? <IconImage size={14} aria-hidden="true" /> : <IconBot size={14} aria-hidden="true" />}
            <span className="composer-menu-entry-label">{imageMode ? t("images.model") : t("chat.model")}</span>
            <span className="composer-menu-entry-value" title={modelLabel}>{modelLabel}</span>
            <IconChevronRight size={14} aria-hidden="true" />
          </button>
          {!imageMode && <small role="status">{t(controller.ultraAvailable ? "ultra.hint" : "ultra.unavailable")}</small>}
          {/* Reasoning stays on the native inline slider. */}
          {!imageMode && thinkingMenuLevels.length > 1 ? (
            <ThinkingLevelSlider
              key={`${selectedProviderId}:${selectedModelId}:${thinkingMenuLevels.join("|")}`}
              levels={thinkingMenuLevels}
              level={thinkingLevel}
              label={t("chat.reasoningLevel")}
              commit={commitThinkingLevel}
            />
          ) : null}
        </div>
      ) : (
        <>
          <button
            type="button"
            className="composer-menu-back"
            role="menuitem"
            onClick={() => showView(view === "group" ? "model" : "root")}
          >
            <IconChevronLeft size={14} aria-hidden="true" />
            <span>{view === "group" ? pendingMirrorModel : view === "model" ? (imageMode ? t("images.model") : t("chat.model")) : t("chat.model")}</span>
          </button>
          <div className="composer-menu-separator" />
          {view === "model" ? (
            <>
              <ComposerModelList
                t={t} query={query} setQuery={setQuery}
                modelSearchRef={modelSearchRef} modelListRef={modelListRef}
                modelGroups={modelGroups} modelHighlight={modelHighlight}
                setModelHighlight={setModelHighlight} selectModel={selectModel}
                selectedProviderId={selectedProviderId} selectedModelId={selectedModelId}
                accountSelected={mirrorCodingSelected}
              />
            </>
          ) : (
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
          )}
        </>
      )}
    </AnchoredMenu>
  );
}

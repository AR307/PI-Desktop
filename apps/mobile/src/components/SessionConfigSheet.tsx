import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Image as ImageIcon, MessageSquare, SlidersHorizontal, Sparkles, Target } from "lucide-react";
import type { ImageGenerationCapability, MobileModelChoice, MobileTaskMode, SessionThinkingLevel } from "@pi-desktop/shared";
import type { MobileController, MobileView } from "../state/controller";
import { Surface } from "./Surface";

type Panel = "mode" | "model";

const modes: Array<{ id: MobileTaskMode; icon: typeof Sparkles; title: string; hint: string }> = [
  { id: "agent", icon: Sparkles, title: "agent", hint: "modeAgentHint" },
  { id: "plan", icon: SlidersHorizontal, title: "plan", hint: "modePlanHint" },
  { id: "goal", icon: Target, title: "goal", hint: "modeGoalHint" },
  { id: "image", icon: ImageIcon, title: "imageGeneration", hint: "modeImageHint" },
];

export function SessionConfigSheet({ open, panel, close, controller, view }: {
  open: boolean; panel: Panel; close(): void; controller: MobileController; view: MobileView;
}) {
  const session = view.snapshot?.session;
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [activePanel, setActivePanel] = useState<Panel>(panel);
  const [mode, setMode] = useState<MobileTaskMode>(session?.taskMode ?? "agent");
  const [providerId, setProviderId] = useState<string>();
  const [modelId, setModelId] = useState<string>();
  const [thinkingLevel, setThinkingLevel] = useState<SessionThinkingLevel>(session?.configuration?.next.thinkingLevel ?? session?.thinkingLevel ?? "off");
  const [options, setOptions] = useState<{ size?: string; quality?: string; aspectRatio?: string; count?: number }>({ count: 1 });
  const [parametersAdjusted, setParametersAdjusted] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedModel, setExpandedModel] = useState<string>();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    if (!open) return;
    const session = sessionRef.current;
    setActivePanel(panel);
    const next = session?.configuration?.next;
    const image = session?.imageConfig;
    setMode(session?.taskMode ?? "agent");
    setProviderId(session?.taskMode === "image" ? image?.providerId : next?.providerId ?? session?.providerId);
    setModelId(session?.taskMode === "image" ? image?.modelId : next?.modelId ?? session?.modelId);
    setThinkingLevel(next?.thinkingLevel ?? session?.thinkingLevel ?? "off");
    setOptions({ count: 1, ...(image?.options ?? {}) });
    setSearch(""); setExpandedModel(undefined); setParametersAdjusted(false);
  }, [open, panel]);

  const choices = mode === "image" ? view.catalog?.image ?? [] : view.catalog?.chat ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return choices.filter((choice) => !needle || `${choice.displayName} ${choice.modelId} ${choice.providerName} ${choice.groupName ?? ""}`.toLowerCase().includes(needle));
  }, [choices, search]);
  const groups = useMemo(() => {
    const rows = new Map<string, MobileModelChoice[]>();
    for (const choice of filtered) {
      // MirrorCoding rows intentionally share one model row so groups are a
      // second-level choice. Other providers keep same-named models distinct.
      const key = choice.source === "mirrorcoding" ? `mirrorcoding:${choice.modelId}` : `provider:${choice.providerId}:${choice.modelId}`;
      const list = rows.get(key) ?? [];
      list.push(choice); rows.set(key, list);
    }
    return [...rows.entries()];
  }, [filtered]);
  const selected = choices.find((choice) => choice.providerId === providerId && choice.modelId === modelId);
  const busy = Boolean(view.snapshot?.activeTurn || view.snapshot?.queuedTurns.length || view.snapshot?.imageJobs.some((job) => job.status === "running"));
  const modeChanged = mode !== session?.taskMode;

  const changeMode = (nextMode: MobileTaskMode): boolean => {
    setMode(nextMode);
    const nextChoices = nextMode === "image" ? view.catalog?.image ?? [] : view.catalog?.chat ?? [];
    let nextProviderId = providerId;
    let nextModelId = modelId;
    if (!nextChoices.some((choice) => choice.providerId === nextProviderId && choice.modelId === nextModelId)) {
      const preferred = nextMode === "image"
        ? session?.configuration?.image ?? session?.imageConfig
        : session?.configuration?.chat ?? session?.configuration?.next;
      nextProviderId = preferred?.providerId;
      nextModelId = preferred?.modelId;
      setProviderId(nextProviderId);
      setModelId(nextModelId);
    }
    return nextChoices.some((choice) => choice.providerId === nextProviderId && choice.modelId === nextModelId);
  };

  const selectChoice = (choice: MobileModelChoice, groupKey = choice.modelId) => {
    setProviderId(choice.providerId); setModelId(choice.modelId);
    setExpandedModel(groupKey);
    if (mode === "image") {
      const next = compatibleImageOptions(options, choice.image);
      setParametersAdjusted(!sameImageOptions(options, next));
      setOptions(next);
    } else if (choice.supportedThinkingLevels.length && !choice.supportedThinkingLevels.some((level) => level === thinkingLevel)) {
      setThinkingLevel(choice.supportedThinkingLevels[0] ?? "off");
    }
  };

  const apply = async () => {
    if (!session) return;
    if (mode === "image") {
      const choice = choices.find((candidate) => candidate.providerId === providerId && candidate.modelId === modelId);
      if (!choice?.image) return;
      if (await controller.configure({ mode, providerId, modelId, imageConfig: { active: true, providerId, modelId, options } })) close();
    } else {
      if (!providerId || !modelId) return;
      if (await controller.configure({ mode, providerId, modelId, thinkingLevel })) close();
    }
  };

  const modeBlocked = busy || session?.configuration?.blockedReason === "approval_pending";
  const canConfigure = session?.configuration?.canConfigure !== false;
  const chatMode = session?.configuration?.chat?.mode ?? (session?.taskMode !== "image" ? session?.taskMode : undefined) ?? "agent";
  return <Surface open={open} title={t(activePanel === "mode" ? "chooseMode" : "chooseModel")} onClose={close} onBack={activePanel === "model" && panel === "mode" ? () => setActivePanel("mode") : undefined} variant="sheet" footer={<div className="surface-actions"><button type="button" onClick={close}>{t("cancel")}</button><button type="button" className="primary" disabled={!canConfigure || view.configuring || (modeChanged && modeBlocked) || !providerId || !modelId} onClick={apply}>{view.configuring ? t("working") : t("apply")}</button></div>}>
    {activePanel === "mode" ? <div className="mode-options">{modes.map(({ id, icon: Icon, title, hint }) => <button key={id} className={`mode-option ${mode === id ? "selected" : ""}`} disabled={modeBlocked && mode !== id} onClick={() => { if (!changeMode(id)) setActivePanel("model"); }}><span className="mode-icon"><Icon size={19}/></span><span><strong>{t(title)}</strong><small>{t(hint)}</small></span>{mode === id && <Check size={18}/>}</button>)}</div> : <>
      <div className="config-tabs"><button className={mode !== "image" ? "active" : ""} onClick={() => changeMode(chatMode)}><MessageSquare size={16}/>{t("chatModels")}</button><button className={mode === "image" ? "active" : ""} onClick={() => changeMode("image")}><ImageIcon size={16}/>{t("imageModels")}</button></div>
      <input className="model-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("search")} aria-label={t("search")}/>
      <div className="model-groups">{groups.map(([id, rows]) => <div className="model-group" key={id}><button className="model-row" onClick={() => rows.length === 1 ? selectChoice(rows[0]!, id) : setExpandedModel(expandedModel === id ? undefined : id)}><span className="model-row-icon">{mode === "image" ? <ImageIcon size={17}/> : <MessageSquare size={17}/>}</span><span><strong>{rows[0]?.displayName ?? id}</strong><small>{rows[0]?.source === "mirrorcoding" ? rows[0]?.groupName ?? rows[0]?.providerName : rows[0]?.providerName}</small></span><span className="model-row-end">{rows.some((row) => row.providerId === providerId && row.modelId === modelId) && <Check size={16}/>}<ChevronRight size={17} className={expandedModel === id ? "rotate-90" : ""}/></span></button>{expandedModel === id && <div className="model-variants">{rows.map((choice) => <button key={`${choice.providerId}:${choice.groupId ?? choice.groupName ?? "default"}`} className={`model-variant ${choice.providerId === providerId && choice.modelId === modelId ? "selected" : ""}`} onClick={() => selectChoice(choice, id)}><span><strong>{choice.groupName ?? choice.providerName}</strong><small>{choice.groupDescription ?? choice.providerName}</small></span><span className="variant-meta">{choice.dynamicBilling ? t("dynamicBilling") : choice.ratio != null ? `${choice.ratio}×` : ""}</span></button>)}</div>}</div>)}</div>
      {groups.length === 0 && <p className="empty-state">{view.catalog ? t("noModelMatches") : t("working")}</p>}
      {mode !== "image" && selected && selected.supportedThinkingLevels.length > 1 && <label className="config-field">{t("thinkingLevel")}<select aria-label={t("thinkingLevel")} value={thinkingLevel} onChange={(event) => setThinkingLevel(event.target.value as SessionThinkingLevel)}>{selected.supportedThinkingLevels.map((level) => <option key={level} value={level}>{level}</option>)}</select></label>}
      {mode === "image" && selected?.image && <ImageParameters choice={selected} options={options} setOptions={setOptions} t={t}/>} 
      {mode === "image" && parametersAdjusted && <small className="muted config-change-note" role="status">{t("parametersAdjusted")}</small>}
    </>}
  </Surface>;
}

type ImageOptions = { size?: string; quality?: string; aspectRatio?: string; count?: number };

function compatibleImageOptions(current: ImageOptions, capability?: ImageGenerationCapability): ImageOptions {
  return {
    count: Math.min(Math.max(current.count ?? 1, 1), capability?.max_count ?? 1),
    ...(capability?.sizes?.includes(current.size ?? "") ? { size: current.size } : {}),
    ...(capability?.qualities?.includes(current.quality ?? "") ? { quality: current.quality } : {}),
    ...(capability?.aspect_ratios?.includes(current.aspectRatio ?? "") ? { aspectRatio: current.aspectRatio } : {}),
  };
}

function sameImageOptions(left: ImageOptions, right: ImageOptions): boolean {
  return left.size === right.size && left.quality === right.quality && left.aspectRatio === right.aspectRatio && (left.count ?? 1) === (right.count ?? 1);
}

function ImageParameters({ choice, options, setOptions, t }: { choice: MobileModelChoice; options: ImageOptions; setOptions: (value: ImageOptions) => void; t: (key: string) => string }) {
  const capability = choice.image;
  if (!capability) return null;
  const select = (key: "size" | "quality" | "aspectRatio", value: string) => setOptions({ ...options, [key]: value || undefined });
  return <div className="image-parameters"><div className="parameter-heading"><SlidersHorizontal size={16}/><strong>{t("parameters")}</strong></div>{capability.sizes?.length ? <label className="config-field">{t("size")}<select aria-label={t("size")} value={options.size ?? ""} onChange={(event) => select("size", event.target.value)}><option value="">{t("noOptions")}</option>{capability.sizes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}{capability.aspect_ratios?.length ? <label className="config-field">{t("aspectRatio")}<select aria-label={t("aspectRatio")} value={options.aspectRatio ?? ""} onChange={(event) => select("aspectRatio", event.target.value)}><option value="">{t("noOptions")}</option>{capability.aspect_ratios.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}{capability.qualities?.length ? <label className="config-field">{t("quality")}<select aria-label={t("quality")} value={options.quality ?? ""} onChange={(event) => select("quality", event.target.value)}><option value="">{t("noOptions")}</option>{capability.qualities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}<label className="config-field">{t("count")}<select aria-label={t("count")} value={options.count ?? 1} onChange={(event) => setOptions({ ...options, count: Number(event.target.value) })}>{Array.from({ length: capability.max_count }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>{!capability.reference_path && <small className="muted">{t("referenceUnsupported")}</small>}</div>;
}

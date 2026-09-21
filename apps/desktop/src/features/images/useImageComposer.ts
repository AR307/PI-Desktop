import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { validateImageOptions, type ImageGenerationOptions, type ImageSessionConfig, type Mode, type SessionThinkingLevel } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { materializeDraftSession, useAppStore } from "../../stores/app-store";
import type { ComposerDraftController } from "../chat/composer/hooks/useComposerDraft";
import type { ComposerMode } from "../chat/composer/ComposerModePicker";
import { EMPTY_IMAGE_CONFIG, IMAGE_DRAFT_KEY, saveImageConfig, useImageJobs } from "./state";
import { isDefaultSessionTitle, promptFallbackSessionTitle, untitledTaskTitle } from "../../stores/runtime/session-title-runtime";

export function useImageComposer(sessionId: string | undefined, mode: Mode, thinkingLevel: SessionThinkingLevel, draft: ComposerDraftController) {
  const { t } = useTranslation();
  const key = sessionId ?? IMAGE_DRAFT_KEY;
  const config = useAppStore((state) => state.settings?.imageSessions?.[key] ?? EMPTY_IMAGE_CONFIG);
  const providers = useAppStore((state) => state.providers);
  const job = useImageJobs((state) => sessionId ? state.jobs[sessionId] : undefined);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const provider = providers.find((item) => item.id === config.providerId);
  const capability = config.modelId ? provider?.mirrorCoding?.imageModels?.[config.modelId] : undefined;
  const running = job?.status === "running";
  const ready = !!(provider?.enabled && provider.hasSecret && capability);
  const report = (error: unknown) => {
    const code = error instanceof Error ? error.message : String(error);
    useAppStore.getState().showToast(t(`images.${code}`, { defaultValue: code }), { variant: "error" });
  };
  const save = async (next: ImageSessionConfig) => {
    setBusy(true);
    try { await saveImageConfig(key, next); } finally { setBusy(false); }
  };
  const selectMode = async (next: ComposerMode) => {
    if (busy || running) return;
    try {
      // The agent keeps its chat model. Entering image mode exits planning.
      const state = useAppStore.getState();
      await state.configureActiveSession({
        mode: next === "image" ? "agent" : next,
        thinkingLevel,
      });
      await save({ ...config, active: next === "image" });
    } catch (error) { report(error); }
  };
  const selectModel = async (selection: { providerId: string; modelId: string }) => {
    const next = providers.find((item) => item.id === selection.providerId)?.mirrorCoding?.imageModels?.[selection.modelId];
    if (!next) throw new Error("model_or_group_unavailable");
    const options: ImageGenerationOptions = {
      count: Math.min(config.options.count ?? 1, next.max_count),
      ...(config.options.size && next.sizes?.includes(config.options.size) ? { size: config.options.size } : {}),
      ...(config.options.quality && next.qualities?.includes(config.options.quality) ? { quality: config.options.quality } : {}),
      ...(config.options.aspectRatio && next.aspect_ratios?.includes(config.options.aspectRatio) ? { aspectRatio: config.options.aspectRatio } : {}),
    };
    await save({ ...config, ...selection, options });
  };
  const submit = async () => {
    if (submitting.current || !ready || !config.providerId || !config.modelId) return;
    const prompt = draft.readLiveDraft().trim();
    if (!prompt) return;
    const snapshot = draft.draftSnapshot(prompt);
    if (snapshot.fileReferences.some((item) => item.kind !== "image")) { report(new Error("images_only_references")); return; }
    let targetId = sessionId;
    submitting.current = true;
    setBusy(true);
    try {
      validateImageOptions(capability!, config.options, snapshot.fileReferences.length);
      if (!targetId) {
        targetId = await materializeDraftSession() ?? undefined;
        if (!targetId) return;
        await saveImageConfig(targetId, config);
      }
      if (useAppStore.getState().runningSessions[targetId]) return;
      const current = useAppStore.getState().sessions.find((item) => item.id === targetId);
      if (isDefaultSessionTitle(current?.title)) {
        await api.renameSession(targetId, promptFallbackSessionTitle(prompt, untitledTaskTitle()));
        await useAppStore.getState().refreshSessions();
      }
      // A failed or cancelled job leaves its draft untouched for explicit retry.
      await api.generateImage({ sessionId: targetId, jobId: crypto.randomUUID(), providerId: config.providerId,
        modelId: config.modelId, prompt, options: config.options,
        references: snapshot.fileReferences.map((item) => ({ ...item, kind: "image" })),
      });
      draft.clearDraftForKey(targetId);
    } catch (error) { report(error); }
    finally { submitting.current = false; setBusy(false); }
  };
  return {
    active: config.active, mode: config.active ? "image" as const : mode,
    config, provider, capability, ready, running, busy, job,
    label: config.modelId ? `${config.modelId} · ${provider?.mirrorCoding?.groupName ?? t("images.unavailable")}` : t("images.chooseModel"),
    selectMode, selectModel, submit,
    setOptions: (options: ImageGenerationOptions) => { void save({ ...config, options }).catch(report); },
    abort: async () => { if (job) await api.abortImage(job.jobId); },
  };
}

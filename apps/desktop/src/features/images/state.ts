import { create } from "zustand";
import type { ImageGenerationState, ImageSessionConfig } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";

export const IMAGE_DRAFT_KEY = "new-image-task";
export const EMPTY_IMAGE_CONFIG: ImageSessionConfig = { active: false, options: { count: 1 } };
export const useImageJobs = create<{ jobs: Record<string, ImageGenerationState> }>(() => ({ jobs: {} }));

export function startImageEvents(): () => void {
  let disposed = false;
  const received = new Set<string>();
  const accept = (job: ImageGenerationState) => {
    if (disposed) return;
    useImageJobs.setState((state) => ({ jobs: { ...state.jobs, [job.sessionId]: job } }));
    useAppStore.setState((state) => ({
      runningSessions: { ...state.runningSessions, [job.sessionId]: job.status === "running" },
      ...(state.activeSessionId === job.sessionId ? { isRunning: job.status === "running" } : {}),
    }));
  };
  const off = api.onImageState((job) => { received.add(job.sessionId); accept(job); });
  void api.imageJobs().then((jobs) => jobs.filter((job) => !received.has(job.sessionId)).forEach(accept)).catch((error: unknown) => {
    if (!disposed) useAppStore.getState().showToast(String(error), { variant: "error" });
  });
  return () => { disposed = true; off(); };
}

export async function saveImageConfig(key: string, config: ImageSessionConfig): Promise<void> {
  const saved = await api.configureImage(key, config);
  useAppStore.setState((state) => ({ settings: state.settings ? {
    ...state.settings, imageSessions: { ...state.settings.imageSessions, [key]: saved },
  } : state.settings }));
}

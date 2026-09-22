import { create } from "zustand";
import i18next from "i18next";
import type { MirrorCodingAccountState } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";

export const useMirrorCoding = create<{ account: MirrorCodingAccountState | null }>(() => ({ account: null }));

export function observeMirrorCoding(): () => void {
  let disposed = false;
  let eventReceived = false;
  let lastError: string | undefined;
  const accept = (account: MirrorCodingAccountState) => {
    if (disposed) return;
    useMirrorCoding.setState({ account });
    if (account.error === "model_or_group_unavailable" && account.error !== lastError) {
      useAppStore.getState().showToast(i18next.t("mirrorCoding.model_or_group_unavailable"));
    }
    lastError = account.error;
    if (account.sync !== "syncing") {
      void useAppStore.getState().refreshProviders().catch(() => {
        if (!disposed) useAppStore.getState().showToast(i18next.t("mirrorCoding.requestFailed"));
      });
    }
  };
  const unsubscribe = api.onMirrorCodingChanged((state) => { eventReceived = true; accept(state); });
  void api.mirrorCodingState().then((state) => { if (!eventReceived) accept(state); }).catch(() => {
    if (!disposed) useMirrorCoding.setState({ account: { status: "signed_out", sync: "error", error: "requestFailed", pendingRevocation: false } });
  });
  return () => { disposed = true; unsubscribe(); };
}

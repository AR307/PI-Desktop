import { create } from "zustand";
import type { MirrorCodingAccountState } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";

type MirrorCodingState = {
  account: MirrorCodingAccountState | null;
};

export const useMirrorCoding = create<MirrorCodingState>(() => ({ account: null }));

/** Keep the settings page in sync with main-process account and catalog events. */
export function observeMirrorCoding(): () => void {
  let disposed = false;
  let received = false;
  const accept = (account: MirrorCodingAccountState) => {
    if (disposed) return;
    useMirrorCoding.setState({ account });
    if (account.sync !== "syncing") {
      void useAppStore.getState().refreshProviders().catch(() => undefined);
    }
  };
  const unsubscribe = api.onMirrorCodingChanged((state) => {
    received = true;
    accept(state);
  });
  void api.mirrorCodingState().then((state) => {
    if (!received) accept(state);
  }).catch(() => {
    if (!disposed) {
      useMirrorCoding.setState({
        account: {
          status: "signed_out",
          sync: "error",
          error: "requestFailed",
          pendingRevocation: false,
        },
      });
    }
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
}

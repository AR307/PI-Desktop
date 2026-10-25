import { useCallback, useEffect, useRef, useState } from "react";
import type { MirrorCodingBenefitsState } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useMirrorCoding } from "./state";

export function useAccountBenefits() {
  const account = useMirrorCoding((state) => state.account);
  const connected = account?.status === "connected";
  const identity = connected ? `${account.account?.id}:${account.authorizationExpiresAt}` : "";
  const [state, setState] = useState<MirrorCodingBenefitsState>({ status: "idle" });
  const displayedIdentity = useRef("");
  const sequence = useRef(0);
  const busy = useRef(false);
  const active = useRef(false);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const refresh = useCallback(
    async (checkIn = false) => {
      if (!identity || busy.current || !active.current) return;
      busy.current = true;
      const request = ++sequence.current;
      setState((previous) => ({ ...previous, status: "loading", error: undefined }));
      try {
        const next = checkIn ? await api.mirrorCodingCheckIn() : await api.mirrorCodingBenefits();
        if (active.current && request === sequence.current && currentIdentity.current === identity)
          setState(next);
      } catch {
        if (active.current && request === sequence.current && currentIdentity.current === identity)
          setState({ status: "error", error: "request_failed" });
      } finally {
        if (request === sequence.current) busy.current = false;
      }
    },
    [identity],
  );
  useEffect(() => {
    active.current = true;
    busy.current = false;
    displayedIdentity.current = identity;
    setState({ status: "idle" });
    if (identity) void refresh();
    const visibleRefresh = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    const timer = window.setInterval(visibleRefresh, 60_000);
    return () => {
      active.current = false;
      sequence.current++;
      busy.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [identity, refresh]);
  return {
    connected,
    identity,
    state: displayedIdentity.current === identity ? state : { status: "idle" as const },
    refresh,
  };
}

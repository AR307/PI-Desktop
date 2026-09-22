import { useCallback, useEffect, useRef, useState } from "react";
import type { MobileSyncStatus } from "@pi-desktop/shared";
import { api } from "../../lib/api";

/** Subscribe before reading so a late initial read cannot replace a newer event. */
export function useMobileSync(activate = false) {
  const [state, setState] = useState<MobileSyncStatus>();
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const observedRevision = revision.current;
    const unsubscribe = api.mobileSync.onChanged((value) => {
      revision.current += 1;
      setState(value);
      setError(undefined);
    });
    void (activate ? api.mobileSync.refresh() : api.mobileSync.status()).then((value) => {
      if (mounted.current && observedRevision === revision.current) setState(value);
    }).catch(() => {
      if (mounted.current && observedRevision === revision.current) setError("requestFailed");
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, [activate]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError(undefined);
    const observedRevision = revision.current;
    try {
      const value = await api.mobileSync.refresh();
      if (mounted.current && observedRevision === revision.current) setState(value);
    } catch {
      if (mounted.current) setError("requestFailed");
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [refreshing]);

  return { state, error, refreshing, refresh };
}

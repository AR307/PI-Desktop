import { useEffect } from "react";

export function useBackDismiss(active: boolean, dismiss: () => void): void {
  useEffect(() => {
    if (!active) return;
    const back = (event: Event) => { if (!event.defaultPrevented) { event.preventDefault(); dismiss(); } };
    document.addEventListener("pi-mobile-back", back);
    return () => document.removeEventListener("pi-mobile-back", back);
  }, [active, dismiss]);
}

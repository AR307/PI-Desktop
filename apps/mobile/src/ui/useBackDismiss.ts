import { useEffect, useRef } from "react";

const stack: Array<() => void> = [];
export function dismissTopSurface(): boolean {
  const dismiss = stack.at(-1);
  if (!dismiss) return false;
  dismiss();
  return true;
}

export function useBackDismiss(active: boolean, dismiss: () => void): void {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    if (!active) return;
    const back = () => latest.current();
    stack.push(back);
    return () => { const index = stack.indexOf(back); if (index >= 0) stack.splice(index, 1); };
  }, [active]);
}

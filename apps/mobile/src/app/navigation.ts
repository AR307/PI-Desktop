import { flushSync } from "react-dom";

export type NavDirection = "push" | "pop" | "tab";

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> } };

export const supportsViewTransitions = () => typeof (document as TransitionDocument).startViewTransition === "function";
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Apply a React state change as a directional screen transition. Inside a View
 * Transition the change is committed synchronously so the browser captures
 * the new screen; elsewhere it is an ordinary state update and the screen's
 * own enter animation plays.
 */
export function navigate(direction: NavDirection, apply: () => void): void {
  const doc = document as TransitionDocument;
  if (!supportsViewTransitions() || reducedMotion()) { apply(); return; }
  const root = document.documentElement;
  root.dataset.nav = direction;
  const transition = doc.startViewTransition!(() => flushSync(apply));
  // A newer navigation skips this one; the state change has still been applied.
  transition.ready.catch(() => undefined);
  void transition.finished.finally(() => { if (root.dataset.nav === direction) delete root.dataset.nav; });
}

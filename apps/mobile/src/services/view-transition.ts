/**
 * Wrap a synchronous route flip in the View Transitions API when the WebView
 * supports it and the user has not reduced motion; otherwise run it directly.
 * Callers pass the action whose first synchronous state patch changes screens.
 */
export function withViewTransition(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (typeof doc.startViewTransition === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    doc.startViewTransition(() => update());
  } else {
    update();
  }
}

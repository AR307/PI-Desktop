import { useSyncExternalStore } from "react";
import type { MobileController, MobileView } from "./controller";

/**
 * Slice subscription over the controller store. `patch()` keeps unchanged
 * fields referentially stable, so a component selecting only what it renders
 * skips the re-renders other slices cause (grant polling, unrelated sessions).
 * Selectors must return a stable reference for an unchanged slice — pick view
 * fields directly rather than building fresh objects.
 */
export function useMobileStore<T>(controller: MobileController, selector: (view: MobileView) => T): T {
  return useSyncExternalStore(controller.subscribe, () => selector(controller.getSnapshot()));
}

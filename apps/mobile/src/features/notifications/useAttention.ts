import { useSyncExternalStore } from "react";
import type { MobileController } from "../../state/controller";

/** Re-render on inbox, unread and toast changes. */
export function useAttention(controller: MobileController) {
  const center = controller.attention;
  useSyncExternalStore(center.subscribe, () => center.version);
  return { items: center.items, unread: center.unread, toast: center.toast, center };
}

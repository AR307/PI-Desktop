import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from "@capacitor/core";

const nativeAppearance = registerPlugin<{ setTheme(options: { theme: "light" | "dark" }): Promise<void> }>("MobileAppearance");

/** Old Android WebViews use native inset padding; modern ones paint the CSS canvas. */
export async function applyNativeAppearance(theme: "light" | "dark"): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() === "android") await nativeAppearance.setTheme({ theme });
  await SystemBars.setStyle({ style: theme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
}

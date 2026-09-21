import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, MoreHorizontal, X } from "lucide-react";
import type { MobileController } from "./state/controller";
import { Login } from "./components/Login";
import { Home, Sessions } from "./components/Home";
import { Conversation } from "./components/Conversation";
import { applyNativeAppearance } from "./services/appearance";
import { AccountSheet } from "./components/AccountSheet";
import { dismissTopSurface } from "./components/useBackDismiss";

export function App({ controller }: { controller: MobileController }) {
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { t } = useTranslation("translation", { keyPrefix: "mobile" });
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("pi.mobile.theme") ?? "system");
  useEffect(() => { void controller.start(); return () => { void controller.dispose(); }; }, [controller]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const resolved = theme === "system" ? media.matches ? "dark" : "light" : theme === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = resolved;
      void applyNativeAppearance(resolved).catch((error: unknown) => console.error("Unable to update system bar appearance", error));
    };
    update(); media.addEventListener("change", update); localStorage.setItem("pi.mobile.theme", theme);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  useEffect(() => {
    const handleBack = () => {
      if (dismissTopSurface()) return;
      if (menu) { setMenu(false); return; }
      const current = controller.getSnapshot();
      if (current.challenge) controller.cancelChallenge();
      else if (current.grant) controller.back();
      else if (Capacitor.isNativePlatform()) void NativeApp.minimizeApp();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") handleBack(); };
    window.addEventListener("keydown", key);
    const back = Capacitor.isNativePlatform() ? NativeApp.addListener("backButton", handleBack) : undefined;
    const active = Capacitor.isNativePlatform() ? NativeApp.addListener("appStateChange", ({ isActive }) => { if (isActive) void controller.resume(); }) : undefined;
    return () => { window.removeEventListener("keydown", key); void back?.then((listener) => listener.remove()); void active?.then((listener) => listener.remove()); };
  }, [controller, menu]);
  useEffect(() => { const focus = () => { void controller.resume(); }; window.addEventListener("online", focus); return () => window.removeEventListener("online", focus); }, [controller]);
  const selectedSession = view.snapshot?.session ?? view.sessions.find((session) => session.id === view.selectedId);
  const desktop = view.grant ? view.devices.find((device) => device.deviceId === view.grant?.desktopDeviceId) : undefined;
  const connectionLabel = t(view.connection === "connected" ? "online" : view.connection === "connecting" ? "connecting" : view.connection === "reconnecting" ? "reconnecting" : "offline");
  const headerTitle = selectedSession?.title ?? view.grant?.scope.label ?? t("title");
  return <div className="mobile-shell">
    <header className="app-header">{view.grant ? <button className="icon-button" aria-label={t("back")} onClick={() => controller.back()}><ArrowLeft size={21}/></button> : <span className="wordmark">π</span>}<span className="app-heading"><strong>{headerTitle}</strong>{view.grant && <small>{desktop?.name ?? t("unavailable")} · {connectionLabel}</small>}</span><button className="icon-button" aria-label={t("menu")} onClick={() => setMenu(true)}><MoreHorizontal size={22}/></button></header>
    {view.grant && <div className={`connection-bar ${view.connection === "connected" ? "connected" : ""}`} role="status" aria-label={t("connectionStatus")}><span className="status-dot"/>{t(view.connection === "connected" ? "online" : view.connection === "connecting" ? "connecting" : view.connection === "reconnecting" ? "reconnecting" : "offline")}{view.connection === "error" && <button onClick={() => view.grant && void controller.openGrant(view.grant)}>{t("retry")}</button>}</div>}
    {(view.error || view.notice) && <div className={`notice ${view.error ? "error" : ""}`} role={view.error ? "alert" : "status"}><span>{t(view.error ?? view.notice ?? "request_failed", { defaultValue: view.error ?? view.notice })}</span><button className="icon-button" aria-label={t("close")} onClick={() => controller.clearError()}><X size={16}/></button></div>}
    {view.loading && !view.signedIn ? <main className="empty-state">{t("working")}</main> : !view.signedIn ? <Login controller={controller} view={view}/> : view.selectedId ? <Conversation key={`${view.grant?.desktopDeviceId}:${view.selectedId}`} controller={controller} view={view}/> : view.grant ? <Sessions controller={controller} view={view}/> : <Home controller={controller} view={view}/>}
    <AccountSheet open={menu} close={() => setMenu(false)} controller={controller} theme={theme} setTheme={setTheme}/>
  </div>;
}

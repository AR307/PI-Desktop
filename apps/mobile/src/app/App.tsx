import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { AlertTriangle, CheckCircle2, CircleAlert, Hand, Image as ImageIcon, Info } from "lucide-react";
import type { MobileController } from "../state/controller";
import { attentionCategory } from "../state/attention";
import { applyNativeAppearance } from "../services/appearance";
import { formatAttention } from "../services/attention-text";
import { useMobileUpdate } from "../features/updates/useMobileUpdate";
import { useAttention } from "../features/notifications/useAttention";
import { PairingSheet } from "../features/pairing/PairingSheet";
import { LoginScreen } from "../screens/LoginScreen";
import { SessionsScreen } from "../screens/SessionsScreen";
import { ActivityScreen } from "../screens/ActivityScreen";
import { SettingsScreen, type ThemeChoice } from "../screens/SettingsScreen";
import { ConversationScreen } from "../screens/ConversationScreen";
import { dismissTopSurface } from "../ui/useBackDismiss";
import { Toast } from "../ui/Toasts";
import { navigate, supportsViewTransitions } from "./navigation";
import { TabBar, type Tab } from "./TabBar";

type Route = { kind: "tabs" } | { kind: "conversation"; desktopId: string; sessionId: string };
const NOTICE_TOAST_MS = 3500;
const ATTENTION_TOAST_MS = 5000;
const routeKey = (desktopId: string, sessionId: string) => `${desktopId}:${sessionId}`;

function readTheme(): ThemeChoice {
  try { const value = localStorage.getItem("pi.mobile.theme"); return value === "light" || value === "dark" ? value : "system"; } catch { return "system"; }
}

export function App({ controller }: { controller: MobileController }) {
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const { t, i18n } = useTranslation("translation", { keyPrefix: "mobile" });
  const { t: translate } = useTranslation();
  const mobileUpdate = useMobileUpdate();
  const { unread, toast } = useAttention(controller);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [tab, setTab] = useState<Tab>("sessions");
  const [route, setRoute] = useState<Route>({ kind: "tabs" });
  const [pairing, setPairing] = useState(false);
  /** A conversation the user opened before the controller selected it. */
  const opening = useRef<string | undefined>(undefined);
  /** A conversation the user left before the controller cleared it. */
  const closing = useRef<string | undefined>(undefined);
  const animated = supportsViewTransitions();

  useEffect(() => { void controller.start(); return () => { void controller.dispose(); }; }, [controller]);
  // Signing out ends every account surface; the next account starts on Sessions.
  useEffect(() => {
    if (view.signedIn) return;
    setPairing(false); setTab("sessions"); setRoute({ kind: "tabs" });
    opening.current = undefined; closing.current = undefined;
  }, [view.signedIn]);

  // Theme, language and notification text follow the user's choices.
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? media.matches ? "dark" : "light" : theme;
      document.documentElement.dataset.theme = resolved;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#181818" : "#ffffff");
      void applyNativeAppearance(resolved).catch((error: unknown) => console.error("Unable to update system bar appearance", error));
    };
    apply(); media.addEventListener("change", apply);
    try { localStorage.setItem("pi.mobile.theme", theme); } catch { /* the theme still applies to this session */ }
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const sync = (language: string) => {
      document.documentElement.lang = language.startsWith("zh") ? "zh-CN" : "en";
      void controller.notifications.configure({ attention: t("channelAttention"), results: t("channelResults"), background: t("channelBackground"), publicText: t("notificationPublicText") });
    };
    sync(i18n.language);
    i18n.on("languageChanged", sync);
    return () => { i18n.off("languageChanged", sync); };
  }, [controller, i18n, t]);

  // The route follows controller-driven selection changes too: notification
  // taps, a shared session disappearing, or sign-out.
  useEffect(() => {
    const selected = view.selectedId && view.desktopId ? routeKey(view.desktopId, view.selectedId) : undefined;
    if (closing.current) {
      if (selected === closing.current) return;
      closing.current = undefined;
    }
    if (view.selectedId && view.desktopId) {
      const key = routeKey(view.desktopId, view.selectedId);
      if (opening.current === key) opening.current = undefined;
      if (route.kind !== "conversation" || routeKey(route.desktopId, route.sessionId) !== key) {
        const target: Route = { kind: "conversation", desktopId: view.desktopId, sessionId: view.selectedId };
        navigate("push", () => setRoute(target));
      }
    } else if (route.kind === "conversation" && opening.current !== routeKey(route.desktopId, route.sessionId)) {
      navigate("pop", () => setRoute({ kind: "tabs" }));
    }
  }, [view.selectedId, view.desktopId, route]);

  const openSession = useCallback((desktopId: string, sessionId: string) => {
    const key = routeKey(desktopId, sessionId);
    opening.current = key; closing.current = undefined;
    navigate("push", () => setRoute({ kind: "conversation", desktopId, sessionId }));
    void controller.openSession(desktopId, sessionId).finally(() => {
      if (opening.current !== key) return;
      opening.current = undefined;
      // The session could not be opened (it left the share, or the computer went away).
      if (controller.getSnapshot().selectedId !== sessionId) navigate("pop", () => setRoute({ kind: "tabs" }));
    });
  }, [controller]);
  const closeSession = useCallback(() => {
    const current = controller.getSnapshot();
    opening.current = undefined;
    closing.current = current.selectedId && current.desktopId ? routeKey(current.desktopId, current.selectedId) : undefined;
    navigate("pop", () => setRoute({ kind: "tabs" }));
    void controller.closeSession();
  }, [controller]);
  const changeTab = useCallback((next: Tab) => {
    if (next !== tab) navigate("tab", () => setTab(next));
  }, [tab]);

  // Android Back closes the innermost surface, then the conversation, then returns to Sessions.
  useEffect(() => {
    const back = () => {
      if (dismissTopSurface()) return;
      if (controller.getSnapshot().challenge) controller.cancelChallenge();
      else if (route.kind === "conversation") closeSession();
      else if (tab !== "sessions") changeTab("sessions");
      else if (Capacitor.isNativePlatform()) void NativeApp.minimizeApp();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") back(); };
    window.addEventListener("keydown", key);
    const listener = Capacitor.isNativePlatform() ? NativeApp.addListener("backButton", back) : undefined;
    return () => { window.removeEventListener("keydown", key); void listener?.then((handle) => handle.remove()); };
  }, [controller, route.kind, tab, closeSession, changeTab]);

  // Foreground state decides between in-app toasts and system notifications.
  useEffect(() => {
    const visible = () => { const active = document.visibilityState === "visible"; controller.setForeground(active); if (active) void controller.resume(); };
    document.addEventListener("visibilitychange", visible);
    const state = Capacitor.isNativePlatform() ? NativeApp.addListener("appStateChange", ({ isActive }) => { controller.setForeground(isActive); if (isActive) void controller.resume(); }) : undefined;
    const online = () => { void controller.resume(); };
    window.addEventListener("online", online);
    return () => { document.removeEventListener("visibilitychange", visible); void state?.then((handle) => handle.remove()); window.removeEventListener("online", online); };
  }, [controller]);

  const error = view.error && !pairing ? view.error : undefined;
  const errorToast = error ? <Toast key={`error:${error}`} role="alert" tone="error" icon={<span className="toast-icon"><CircleAlert size={18}/></span>}
    title={t(error, { defaultValue: error })} body={view.retryAt ? t("retryAt", { time: new Date(view.retryAt).toLocaleTimeString() }) : undefined} onDismiss={() => controller.clearError()}/> : null;

  if (view.loading && !view.signedIn) return <div className="mobile-shell"><main className="login-page"><div className="login-hero"><div className="brand-mark" aria-hidden="true"><img src="/logo.svg" alt=""/></div></div></main></div>;
  if (!view.signedIn) return <div className="mobile-shell"><LoginScreen controller={controller} view={view} update={mobileUpdate}/><div className="toast-layer">{errorToast}</div></div>;

  const inConversation = route.kind === "conversation";
  const conversationRow = inConversation ? view.directories.find((row) => row.desktopDeviceId === route.desktopId) : undefined;
  const toastText = toast ? formatAttention(toast, translate) : undefined;
  const ToastIcon = !toast ? Info : toast.kind === "completed" ? toast.image ? ImageIcon : CheckCircle2 : toast.kind === "failed" ? AlertTriangle : Hand;
  const enter = (name: string) => animated ? "" : name;
  return <div className="mobile-shell">
    <div className={`screen ${enter("screen-enter-pop")}`} hidden={inConversation}>
      {/* Sessions stays mounted to keep its scroll, search and filter; the others mount on demand. */}
      <div className={`screen ${enter("screen-enter-tab")}`} hidden={tab !== "sessions"}><SessionsScreen controller={controller} view={view} onOpen={openSession} onPair={() => setPairing(true)}/></div>
      {tab === "activity" && <div className={`screen ${enter("screen-enter-tab")}`}><ActivityScreen controller={controller} view={view} onOpen={openSession}/></div>}
      {tab === "me" && <div className={`screen ${enter("screen-enter-tab")}`}><SettingsScreen controller={controller} view={view} theme={theme} setTheme={setTheme} update={mobileUpdate} onPair={() => setPairing(true)}/></div>}
      <TabBar tab={tab} onChange={changeTab} unread={unread}/>
    </div>
    {inConversation && <ConversationScreen key={routeKey(route.desktopId, route.sessionId)} className={enter("screen-enter-push")}
      controller={controller} desktopId={route.desktopId} sessionId={route.sessionId} directory={conversationRow} onBack={closeSession}/>}
    <div className="toast-layer">
      {toast && toastText && <Toast key={toast.key} autoDismissMs={ATTENTION_TOAST_MS} icon={<span className={`toast-icon ${attentionCategory(toast.kind)}`}><ToastIcon size={18}/></span>}
        title={toastText.title} body={toastText.body} onPress={() => openSession(toast.desktopDeviceId, toast.sessionId)} onDismiss={() => controller.attention.dismissToast()}/>}
      {errorToast ?? (view.notice ? <Toast key={`notice:${view.notice}`} autoDismissMs={NOTICE_TOAST_MS} icon={<span className="toast-icon"><Info size={18}/></span>}
        title={t(view.notice, { defaultValue: view.notice })} onDismiss={() => controller.clearError()}/> : null)}
    </div>
    <PairingSheet open={pairing} close={() => setPairing(false)} controller={controller} view={view}/>
  </div>;
}

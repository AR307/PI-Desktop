import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import i18n from "./i18n";
import { MobileAccount } from "./services/account";
import { formatAttention } from "./services/attention-text";
import { serviceOrigin } from "./services/config";
import { createNotificationBridge, type NotificationRecorder } from "./services/notifications";
import { nativeCredentialStore, type CredentialStore } from "./services/storage";
import { MobileController } from "./state/controller";
import "./styles.css";

if (import.meta.env.MODE === "acceptance") {
  void import("./test/persistence-acceptance").then(({ persistenceAcceptance }) => {
    window.__PI_MOBILE_PERSISTENCE_TEST__ = persistenceAcceptance;
  });
}

declare global {
  interface Window {
    __PI_MOBILE_TEST__?: { credentialStore: CredentialStore; notifications?: NotificationRecorder };
    __PI_MOBILE_CONTROLLER__?: MobileController;
    __PI_MOBILE_PERSISTENCE_TEST__?: typeof import("./test/persistence-acceptance").persistenceAcceptance;
  }
}

const acceptance = import.meta.env.MODE === "acceptance" ? window.__PI_MOBILE_TEST__ : undefined;
const store = acceptance?.credentialStore ?? nativeCredentialStore();
const t = i18n.t.bind(i18n);
const controller = new MobileController(new MobileAccount(serviceOrigin(), store), {
  notifications: createNotificationBridge(acceptance?.notifications),
  formatAttention: (item) => formatAttention(item, t),
  keepAliveText: (count) => ({ title: t("mobile.keepAliveTitle"), body: count > 0 ? t("mobile.keepAliveWorking", { count }) : t("mobile.keepAliveIdle") }),
});
if (import.meta.env.MODE === "acceptance") window.__PI_MOBILE_CONTROLLER__ = controller;
const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
createRoot(root).render(<App controller={controller}/>);

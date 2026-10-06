import { createRoot } from "react-dom/client";
import { App } from "./App";
import { MobileAccount } from "./services/account";
import { serviceOrigin } from "./services/config";
import { nativeCredentialStore, type CredentialStore } from "./services/storage";
import { MobileController } from "./state/controller";
import "./i18n";
import "./styles.css";

if (import.meta.env.MODE === "acceptance") {
  void import("./test/persistence-acceptance").then(({ persistenceAcceptance }) => {
    window.__PI_MOBILE_PERSISTENCE_TEST__ = persistenceAcceptance;
  });
}

declare global {
  interface Window {
    __PI_MOBILE_TEST__?: { credentialStore: CredentialStore };
    __PI_MOBILE_CONTROLLER__?: MobileController;
    __PI_MOBILE_PERSISTENCE_TEST__?: typeof import("./test/persistence-acceptance").persistenceAcceptance;
  }
}

const store = import.meta.env.MODE === "acceptance" && window.__PI_MOBILE_TEST__
  ? window.__PI_MOBILE_TEST__.credentialStore : nativeCredentialStore();
const controller = new MobileController(new MobileAccount(serviceOrigin(), store));
if (import.meta.env.MODE === "acceptance") window.__PI_MOBILE_CONTROLLER__ = controller;
const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
createRoot(root).render(<App controller={controller}/>);

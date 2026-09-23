import { join } from "node:path";
import { app, safeStorage } from "electron";
import {
  IPC,
  MIRRORCODING_ORIGIN,
  type AppSettings,
  type MirrorCodingProvider,
  type ProviderPublic,
} from "@pi-desktop/shared";
import { capabilitiesFromModelConfig, modelConfigWithBinding, type RuntimeProviderConfig } from "@pi-desktop/agent-runtime";
import type { HostProcess } from "../host-process";
import type { ModelsDevCatalog } from "../models-dev-catalog";
import { ImageService, type ImageServiceDependencies } from "../images/service";
import { MirrorCodingAccount } from "./account";
import { modelMetadata } from "./catalog";
import { MirrorCodingCredentials } from "./credentials";
import { MirrorCodingRelay, type MirrorCodingRelayFailure } from "./relay";

type Dependencies = ImageServiceDependencies & {
  dataDir: string;
  getHost(): HostProcess | null;
  modelsDev: ModelsDevCatalog;
  openExternal(url: string): Promise<void>;
  send(channel: string, state: unknown): void;
  logRelayFailure?(failure: MirrorCodingRelayFailure): void;
};

export function createMirrorCodingRuntime(deps: Dependencies) {
  const host = () => {
    const value = deps.getHost();
    if (!value) throw new Error("host_unavailable");
    return value;
  };
  // Only unpackaged, isolated local acceptance may replace the official origin.
  let origin = MIRRORCODING_ORIGIN;
  const testOrigin = process.env.PI_DESKTOP_MIRRORCODING_TEST_ORIGIN;
  if (!app.isPackaged && testOrigin && process.env.PI_DESKTOP_DATA_DIR) {
    const url = new URL(testOrigin);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/") throw new Error("invalid_test_origin");
    origin = url.origin;
  }
  const completeWelcome = async () => {
    const settings = await host().call<AppSettings>("settings.get");
    await host().call("settings.set", { ...settings, mirrorCodingWelcomeCompleted: true });
  };
  const account = new MirrorCodingAccount({
    origin, credentials: new MirrorCodingCredentials(join(deps.dataDir, "mirrorcoding.enc"), safeStorage),
    fetch: (...args) => globalThis.fetch(...args), modelsDev: deps.modelsDev,
    openExternal: deps.openExternal, completeWelcome,
    syncProviders: async (input) => { await host().call("providers.syncMirrorCoding", input); },
    changed: (state) => deps.send(IPC.event.mirrorCodingChanged, state),
  });
  const relay = new MirrorCodingRelay(account, deps.logRelayFailure);
  const images = new ImageService(deps, account, relay);

  const bindingFor = async (providerId: string, modelId: string, sessionId?: string): Promise<RuntimeProviderConfig> => {
    await account.initialize();
    const result = await host().call<{ provider?: ProviderPublic }>("providers.get", { id: providerId });
    const provider = result.provider;
    if (!provider?.enabled || !provider.mirrorCoding || !provider.models.some((model) => model.id === modelId)) {
      throw new Error("model_or_group_unavailable");
    }
    const binding = await relay.bind(providerId, provider.mirrorCoding, modelId, sessionId);
    const modelConfig = {
      ...modelConfigWithBinding(modelMetadata(deps.modelsDev, modelId), provider.models.find((model) => model.id === modelId)),
      api: binding.api, baseUrl: binding.baseUrl,
    };
    const capabilities = capabilitiesFromModelConfig(modelConfig);
    return {
      id: providerId, name: provider.name, vendorKey: "mirrorcoding", authKind: "mirrorcoding",
      modelId, ...binding, modelConfig, ...capabilities, supportedThinkingLevels: [...capabilities.supportedThinkingLevels],
    };
  };

  const isReady = (metadata?: MirrorCodingProvider): boolean => {
    const state = account.snapshot();
    return Boolean(metadata && state.status === "connected" && state.account?.id === metadata.accountId);
  };
  return {
    account, relay, bindingFor, isReady, completeWelcome, images,
    async start() { await account.initialize(); void account.refreshCatalog(); void account.retryRevocation(); },
    dispose() { images.dispose(); account.dispose(); relay.dispose(); },
  };
}
export type MirrorCodingRuntime = ReturnType<typeof createMirrorCodingRuntime>;

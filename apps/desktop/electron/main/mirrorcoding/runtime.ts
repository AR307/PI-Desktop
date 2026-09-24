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
import { MirrorCodingRelay } from "./relay";

type Dependencies = ImageServiceDependencies & {
  dataDir: string;
  getHost(): HostProcess | null;
  modelsDev: ModelsDevCatalog;
  openExternal(url: string): Promise<void>;
  send(channel: string, state: unknown): void;
};

export function createMirrorCodingRuntime(deps: Dependencies) {
  const host = () => {
    const value = deps.getHost();
    if (!value) throw new Error("host_unavailable");
    return value;
  };
  // Only unpackaged, isolated local acceptance may replace the official origin.
  let origin: string = MIRRORCODING_ORIGIN;
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
  const relay = new MirrorCodingRelay(account);
  const images = new ImageService(deps, account, relay);

  const bindingFor = async (providerId: string, modelId: string, sessionId?: string): Promise<RuntimeProviderConfig> => {
    await account.initialize();
    const result = await host().call<{ provider?: ProviderPublic }>("providers.get", { id: providerId });
    const provider = result.provider;
    if (!provider?.enabled || !provider.mirrorCoding) {
      throw new Error("model_or_group_unavailable");
    }
    const providers = await host().call<{ providers: ProviderPublic[] }>("providers.list", { includeDisabled: false });
    const accountProvider = provider.mirrorCoding.scope === "account"
      ? provider
      : providers.providers.find((candidate) => candidate.mirrorCoding?.scope === "account" && candidate.mirrorCoding.accountId === provider.mirrorCoding?.accountId);
    const model = accountProvider?.models.find((entry) => entry.id === modelId) ?? provider.models.find((entry) => entry.id === modelId);
    if (!model) throw new Error("model_or_group_unavailable");
    const groupId = provider.mirrorCoding.scope === "account"
      ? model.mirrorCodingGroupId
      : provider.mirrorCoding.groupId;
    const binding = await relay.bind(providerId, provider.mirrorCoding, modelId, sessionId, groupId);
    const modelConfig = {
      ...modelConfigWithBinding(modelMetadata(deps.modelsDev, modelId), model),
      api: binding.api, baseUrl: binding.baseUrl,
    };
    const capabilities = capabilitiesFromModelConfig(modelConfig);
    return {
      id: providerId, name: provider.name, vendorKey: "mirrorcoding", authKind: "mirrorcoding",
      modelId, ...binding, modelConfig, temperature: model.temperature,
      defaultThinkingLevel: model.defaultThinkingLevel,
      ...capabilities, supportedThinkingLevels: [...capabilities.supportedThinkingLevels],
    };
  };

  const bindingForImage = async (
    providerId: string,
    modelId: string,
    sessionId: string | undefined,
    edit: boolean,
  ): Promise<RuntimeProviderConfig> => {
    await account.initialize();
    const result = await host().call<{ provider?: ProviderPublic }>("providers.get", { id: providerId });
    const provider = result.provider;
    const providers = provider
      ? await host().call<{ providers: ProviderPublic[] }>("providers.list", { includeDisabled: false })
      : { providers: [] };
    const accountProvider = provider?.mirrorCoding?.scope === "account"
      ? provider
      : providers.providers.find((candidate) => candidate.mirrorCoding?.scope === "account" && candidate.mirrorCoding.accountId === provider?.mirrorCoding?.accountId);
    const model = accountProvider?.models.find((entry) => entry.id === modelId) ?? provider?.models.find((entry) => entry.id === modelId);
    if (!provider?.enabled || !provider.mirrorCoding || !model) {
      throw new Error("model_or_group_unavailable");
    }
    const groupId = provider.mirrorCoding.scope === "account" ? model.mirrorCodingGroupId : provider.mirrorCoding.groupId;
    const binding = await relay.bindImage(providerId, provider.mirrorCoding, modelId, sessionId, edit, groupId);
    const modelConfig = {
      ...modelConfigWithBinding(modelMetadata(deps.modelsDev, modelId), model),
      baseUrl: binding.baseUrl,
    };
    const capabilities = capabilitiesFromModelConfig(modelConfig);
    return {
      id: providerId, name: provider.name, vendorKey: "mirrorcoding", authKind: "mirrorcoding",
      modelId, ...binding, modelConfig, temperature: model.temperature,
      defaultThinkingLevel: model.defaultThinkingLevel,
      ...capabilities, supportedThinkingLevels: [...capabilities.supportedThinkingLevels],
    };
  };

  const isReady = (metadata?: MirrorCodingProvider): boolean => {
    const state = account.snapshot();
    return Boolean(metadata && state.status === "connected" && state.account?.id === metadata.accountId);
  };
  return {
    account, relay, bindingFor, bindingForImage, isReady, completeWelcome, images,
    async start() { await account.initialize(); void account.refreshCatalog(); void account.retryRevocation(); },
    dispose() { images.dispose(); account.dispose(); relay.dispose(); },
  };
}
export type MirrorCodingRuntime = ReturnType<typeof createMirrorCodingRuntime>;

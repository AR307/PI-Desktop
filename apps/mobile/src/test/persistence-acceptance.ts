import type { MobileDirectoryPage, MobileGrant, MobileSessionSnapshot, UiMessage } from "@pi-desktop/shared";
import { readAccount, readDirectory, saveAccount, saveDirectory } from "../services/account-cache";
import { nativeCredentialStore } from "../services/storage";
import { TranscriptCache, cacheKey } from "../services/transcript-cache";

const accountId = "update-acceptance-account";
const desktopDeviceId = "update-acceptance-desktop";
const sessionId = "update-acceptance-session";
const address = { accountId, desktopDeviceId, sessionId };
const now = "2026-10-06T00:00:00.000Z";
const grant: MobileGrant = {
  id: "update-acceptance-grant", accountId, desktopDeviceId,
  mobileDeviceId: "update-acceptance-phone", mobileDeviceName: "QA phone",
  scope: { kind: "session", id: sessionId, label: "Upgrade history" }, createdAt: now,
};
const directory: MobileDirectoryPage = {
  desktopDeviceId, generatedAt: now, projects: [], sessions: [{
    id: sessionId, title: "Upgrade history", mode: "agent", status: "idle",
    planningState: "inactive", permissionMode: "ask", queuedTurnIds: [],
    revision: 0, createdAt: now, updatedAt: now, taskMode: "agent",
    capabilities: { canPrompt: false, canStop: false },
  }],
};
const message: UiMessage = { id: "update-acceptance-message", role: "user", content: "History survives upgrade", createdAt: now, status: "complete" };
const snapshot: MobileSessionSnapshot = {
  session: directory.sessions[0]!, queuedTurns: [], items: [], activeItems: [],
  pendingApprovals: [], pendingInputs: [], hasMoreHistory: false,
  cursor: { epoch: "update-acceptance", sequence: 1 }, revision: 1,
  syncRevision: 1, generatedAt: now, imageJobs: [], plans: [],
};

/** Only imported by acceptance builds; never uses a production account. */
export const persistenceAcceptance = {
  async seed() {
    await nativeCredentialStore().write(JSON.stringify({
      accessToken: "update-acceptance-token", refreshToken: "update-acceptance-refresh",
      expiresAt: "2099-01-01T00:00:00.000Z", account: { id: accountId, name: "Upgrade QA" },
      deviceId: "update-acceptance-phone", deviceSecret: "update-acceptance-device",
    }));
    await saveAccount(accountId, [grant], [{ deviceId: desktopDeviceId, name: "QA computer", kind: "desktop", online: false }], () => true);
    await saveDirectory(accountId, directory, () => true);
    await new TranscriptCache().commit({ ...address, key: cacheKey(address), syncRevision: 1,
      hasMoreHistory: false, snapshot }, [message]);
  },
  async verify() {
    const credentials = await nativeCredentialStore().read();
    const account = await readAccount(accountId);
    const savedDirectory = await readDirectory(accountId, desktopDeviceId);
    const history = await new TranscriptCache().page(address);
    return {
      credentials: credentials ? JSON.parse(credentials).account?.id === accountId : false,
      pairing: account?.grants.some((row) => row.id === grant.id) ?? false,
      directory: savedDirectory?.sessions.some((row) => row.id === sessionId) ?? false,
      history: history.messages.some((row) => row.id === message.id && row.content === message.content),
    };
  },
};

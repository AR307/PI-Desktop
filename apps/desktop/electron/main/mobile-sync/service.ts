import type {
  MobilePairing,
  MobileSyncScopeInput,
  MobileSyncStatus,
} from "@pi-desktop/shared";

/** Main-process boundary implemented by the MC sync runtime. */
export interface MobileSyncService {
  status(): MobileSyncStatus;
  refresh(): Promise<MobileSyncStatus>;
  createPairing(input: MobileSyncScopeInput): Promise<MobilePairing>;
  cancelPairing(id: string): Promise<MobileSyncStatus>;
  revoke(id: string): Promise<MobileSyncStatus>;
  observeInvoke?(channel: string): void;
}

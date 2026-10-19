import type { MirrorCodingBenefits, MirrorCodingBenefitsState } from "@pi-desktop/shared";

type Account = {
  readonly authorizationId: string | undefined;
  snapshot(): { status: string };
  request(path: string, init?: RequestInit): Promise<Response>;
};
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_response");
  return value as RecordValue;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("invalid_response");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("invalid_response");
  return value;
}
function quota(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("invalid_response");
  return value;
}
function date(value: unknown): string {
  const result = text(value);
  if (
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    throw new Error("invalid_response");
  return result;
}

export function parseBenefits(value: unknown): MirrorCodingBenefits {
  const envelope = record(value);
  if (envelope.success !== true) throw new Error("request_failed");
  const data = record(envelope.data);
  const permissions = record(data.permissions);
  const checkIn = record(data.check_in);
  const subscriptionsRead = bool(permissions.subscriptions_read);
  const checkInAllowed = bool(permissions.check_in);
  const quotaPerUnit = quota(data.quota_per_unit);
  if (!quotaPerUnit || !Array.isArray(data.subscriptions)) throw new Error("invalid_response");
  const subscriptions = data.subscriptions.map((value) => {
    const item = record(value);
    if (!Array.isArray(item.groups)) throw new Error("invalid_response");
    return {
      id: text(item.id),
      name: text(item.name),
      expiresAt: date(item.expires_at),
      quotaTotal: item.quota_total === null ? null : quota(item.quota_total),
      quotaUsed: quota(item.quota_used),
      nextResetAt: item.next_reset_at === null ? null : date(item.next_reset_at),
      groups: item.groups.map(text),
    };
  });
  if (
    new Set(subscriptions.map((item) => item.id)).size !== subscriptions.length ||
    (!subscriptionsRead && subscriptions.length)
  )
    throw new Error("invalid_response");
  const checkInDate = text(checkIn.date);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(checkInDate)) throw new Error("invalid_response");
  return {
    subscriptionsRead,
    checkInAllowed,
    subscriptions,
    quotaPerUnit,
    quotaUnit: text(data.quota_unit),
    checkIn: {
      enabled: bool(checkIn.enabled),
      checkedIn: bool(checkIn.checked_in),
      date: checkInDate,
      timeZone: text(checkIn.time_zone),
      reward: checkIn.reward === null ? null : quota(checkIn.reward),
    },
  };
}

/** Separate account feature: no catalog refresh, provider changes or persisted cache. */
export class MirrorCodingBenefitsService {
  private state: MirrorCodingBenefitsState = { status: "idle" };
  private identity?: string;
  private generation = 0;
  private pending?: Promise<MirrorCodingBenefitsState>;
  private abort?: AbortController;
  private disposed = false;
  private account: Account;
  constructor(account: Account) {
    this.account = account;
  }

  private syncIdentity(): void {
    const identity =
      this.account.snapshot().status === "connected" ? this.account.authorizationId : undefined;
    if (identity === this.identity) return;
    this.identity = identity;
    this.generation++;
    this.abort?.abort();
    this.pending = undefined;
    this.state = { status: "idle" };
  }

  async load(checkIn = false): Promise<MirrorCodingBenefitsState> {
    this.syncIdentity();
    if (this.disposed || !this.identity)
      return { status: "error", error: "reauthorization_required" };
    if (this.pending) {
      const identity = this.identity;
      const generation = this.generation;
      const pending = this.pending;
      await pending;
      this.syncIdentity();
      if (identity !== this.identity || generation !== this.generation)
        return { status: "error", error: "reauthorization_required" };
      if (checkIn) return this.load(true);
      return this.snapshot();
    }
    if (checkIn && (!this.state.data?.checkInAllowed || !this.state.data.checkIn.enabled))
      return { ...this.state, error: "permission_required" };
    if (checkIn && this.state.data?.checkIn.checkedIn) return this.snapshot();
    const generation = this.generation;
    const abort = new AbortController();
    this.abort = abort;
    this.state = { ...this.state, status: "loading", error: undefined };
    const work = (async () => {
      try {
        const response = await this.account.request(
          checkIn ? "/api/pi-desktop/account/checkin" : "/api/pi-desktop/account/benefits",
          {
            method: checkIn ? "POST" : "GET",
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]),
          },
        );
        if (!response.ok) {
          let code: MirrorCodingBenefitsState["error"] =
            response.status === 404 || response.status === 501
              ? "unavailable"
              : response.status === 401
                ? "reauthorization_required"
                : response.status === 403
                  ? "permission_required"
                  : "request_failed";
          if (response.status === 403) {
            const body: unknown = await response.json().catch(() => null);
            if (
              body &&
              typeof body === "object" &&
              "error" in body &&
              body.error === "verification_required"
            )
              code = "verification_required";
          } else await response.body?.cancel();
          throw new Error(code);
        }
        const data = parseBenefits(await response.json());
        this.syncIdentity();
        if (generation === this.generation && !this.disposed)
          this.state = { status: "ready", data, updatedAt: Date.now() };
      } catch (error) {
        this.syncIdentity();
        const code = error instanceof Error ? error.message : "request_failed";
        const known = [
          "unavailable",
          "permission_required",
          "reauthorization_required",
          "invalid_response",
          "verification_required",
        ] as const;
        const normalized = known.find((item) => item === code) ?? "request_failed";
        if (generation === this.generation && !this.disposed)
          this.state = { status: "error", error: normalized };
      }
      return this.snapshot();
    })();
    this.pending = work;
    try {
      return await work;
    } finally {
      if (this.pending === work) {
        this.pending = undefined;
        this.abort = undefined;
      }
    }
  }
  snapshot(): MirrorCodingBenefitsState {
    this.syncIdentity();
    return structuredClone(this.state);
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.abort?.abort();
    this.state = { status: "idle" };
  }
}

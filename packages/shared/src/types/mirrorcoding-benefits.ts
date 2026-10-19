/** Account-only projection. Credentials and billing mutations never cross IPC. */
export type MirrorCodingSubscription = {
  id: string;
  name: string;
  expiresAt: string;
  quotaTotal: number | null;
  quotaUsed: number;
  nextResetAt: string | null;
  groups: string[];
};

export type MirrorCodingBenefits = {
  subscriptionsRead: boolean;
  checkInAllowed: boolean;
  subscriptions: MirrorCodingSubscription[];
  quotaPerUnit: number;
  quotaUnit: string;
  checkIn: {
    enabled: boolean;
    checkedIn: boolean;
    date: string;
    timeZone: string;
    reward: number | null;
  };
};

export type MirrorCodingBenefitsState = {
  status: "idle" | "loading" | "ready" | "error";
  data?: MirrorCodingBenefits;
  updatedAt?: number;
  error?:
    | "unavailable"
    | "permission_required"
    | "reauthorization_required"
    | "request_failed"
    | "invalid_response"
    | "verification_required";
};

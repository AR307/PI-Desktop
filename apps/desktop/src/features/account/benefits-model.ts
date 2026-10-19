import type { MirrorCodingBenefits } from "@pi-desktop/shared";

/** Account-wide subscription quota, not wallet balance or a model entitlement. */
export function subscriptionQuota(data: MirrorCodingBenefits, now = Date.now()) {
  const subscriptions = data.subscriptions.filter((item) => Date.parse(item.expiresAt) > now);
  const unlimited = subscriptions.some((item) => item.quotaTotal === null);
  const total = subscriptions.reduce((sum, item) => sum + (item.quotaTotal ?? 0), 0);
  const remaining = subscriptions.reduce(
    (sum, item) => sum + Math.max(0, (item.quotaTotal ?? 0) - item.quotaUsed),
    0,
  );
  const percent =
    unlimited || !subscriptions.length ? null : total > 0 ? (remaining / total) * 100 : 0;
  const tone =
    !data.subscriptionsRead || !subscriptions.length
      ? "unknown"
      : unlimited || (percent ?? 0) > 50
        ? "green"
        : (percent ?? 0) > 20
          ? "yellow"
          : "red";
  return { subscriptions, unlimited, total, remaining, percent, tone };
}

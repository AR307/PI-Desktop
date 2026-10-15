const codes = [
  "RATE_LIMITED", "RELAY_UNAVAILABLE", "DEVICE_MISMATCH", "DEVICE_IDENTITY_MISSING",
  "ACCOUNT_MISMATCH", "GRANT_REVOKED", "DESKTOP_OFFLINE", "PAIRING_CONSUMED",
  "PAIRING_EXPIRED", "PAIRING_INVALID", "INVALID_REQUEST", "AUTH_EXPIRED",
  "mobile_service_unavailable", "secure_storage_unavailable", "mobile_account_sharing_disabled",
] as const;

/** IPC may wrap the server code inside its error message. Never show the wrapper. */
export function mobileSyncErrorKey(error: unknown, otherwise = "requestFailed"): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail === "mobile_revoke_pending") return "revokePending";
  return codes.find((code) => detail.includes(code)) ?? otherwise;
}

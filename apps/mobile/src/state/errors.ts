/**
 * Failures that only mean the phone cannot reach the network right now. They
 * change connectivity state; they are not errors the user must acknowledge.
 * Programming TypeErrors keep reporting normally: only the platform's fetch
 * messages and the relay's own connection failures qualify.
 */
const FETCH_FAILURE = /^(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|Network request failed)$/i;
const RELAY_FAILURE = /^(Relay connection (failed|timed out|closed)|Relay disconnected)$/;

export function isConnectivityError(error: unknown): boolean {
  if (error instanceof TypeError) return FETCH_FAILURE.test(error.message);
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return error.name === "TimeoutError" || error.name === "NetworkError";
  return error instanceof Error && RELAY_FAILURE.test(error.message);
}

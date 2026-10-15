import type { IncomingHttpHeaders } from "node:http";

/**
 * pi-ai adapters do not all preserve the same custom-header path. The relay
 * key is also the local API key, so standard auth headers are safe local
 * binding carriers; they are consumed by the relay and never forwarded.
 */
export function relayBindingKey(headers: IncomingHttpHeaders): string | undefined {
  const explicit = headers["x-pi-mirrorcoding-key"];
  if (typeof explicit === "string" && explicit.length > 0) return explicit;
  for (const name of ["authorization", "x-api-key", "api-key"] as const) {
    const value = headers[name];
    if (typeof value !== "string" || value.length === 0) continue;
    const match = name === "authorization" ? /^Bearer\s+(.+)$/i.exec(value) : /^(.+)$/.exec(value);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

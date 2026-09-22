import { session } from "electron";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import WebSocket from "ws";
import type { MobileRelayTicket } from "@pi-desktop/shared";

/** Use Chromium's already-applied system/custom proxy decision, including its auth relay. */
export async function openMobileRelay(ticket: MobileRelayTicket, origin: string): Promise<WebSocket> {
  const url = new URL(ticket.url, origin);
  const allowed = new URL(origin);
  if (url.host !== allowed.host || url.pathname !== "/api/pi-sync/relay/connect" || url.protocol !== (allowed.protocol === "https:" ? "wss:" : "ws:")) throw new Error("invalid_relay_url");
  url.searchParams.set("ticket", ticket.ticket);
  const target = new URL("/api/pi-sync/relay/connect", origin).href;
  const decision = (await session.defaultSession.resolveProxy(target)).split(";", 1)[0]?.trim();
  let agent: HttpsProxyAgent<string> | SocksProxyAgent | undefined;
  if (decision && decision !== "DIRECT") {
    const [kind, address] = decision.split(/\s+/, 2);
    if (kind === "PROXY" || kind === "HTTPS") {
      agent = new HttpsProxyAgent(`${kind === "HTTPS" ? "https" : "http"}://${address}`);
    } else if (kind === "SOCKS5" || kind === "SOCKS" || kind === "SOCKS4") {
      agent = new SocksProxyAgent(`${kind === "SOCKS5" ? "socks5h" : "socks4a"}://${address}`);
    } else throw new Error("unsupported_relay_proxy");
  }
  // MC envelopes may contain several bounded RACP frames; the outer JSON
  // contract allows up to 8 MiB while RACP itself remains capped at 1 MiB.
  const socket = new WebSocket(url, { agent, handshakeTimeout: 15_000, maxPayload: 8 * 1024 * 1024 });
  socket.once("close", () => agent?.destroy());
  return socket;
}

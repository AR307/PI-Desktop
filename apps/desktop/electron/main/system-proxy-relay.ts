import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { parseProxyUrl, type ParsedProxyUrl } from "@pi-desktop/shared";
import {
  connectTcp,
  connectViaProxy,
  SocketReader,
} from "@pi-desktop/agent-runtime/proxy-tunnel";

const MAX_PROXY_RESOLUTION_LENGTH = 8_192;

export type SystemProxyRelay = {
  url: string;
  close(): Promise<void>;
};

type ProxyRoute = { kind: "direct" } | { kind: "proxy"; proxy: ParsedProxyUrl };

/**
 * Resolve each destination through Electron's active system/PAC configuration,
 * then tunnel the connection through that route. The listener is loopback-only
 * and requires a per-process SOCKS credential before it will resolve a route.
 */
export async function startSystemProxyRelay(
  resolveProxy: (url: string) => Promise<string>,
): Promise<SystemProxyRelay> {
  const password = randomBytes(32).toString("hex");
  const clients = new Set<Socket>();
  const server = createServer((client) => {
    clients.add(client);
    const forget = () => clients.delete(client);
    client.once("close", forget);
    client.once("error", forget);
    void handleClient(client, password, resolveProxy);
  });
  server.on("error", (error) => {
    process.stderr.write(
      `[system-proxy-relay] listener error: ${error.message}\n`,
    );
  });

  const port = await listenLoopback(server);
  return {
    url: `socks5://system-auto:${password}@127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        for (const client of clients) client.destroy();
        clients.clear();
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      }),
  };
}

function listenLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("system proxy relay did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function handleClient(
  client: Socket,
  expectedPassword: string,
  resolveProxy: (url: string) => Promise<string>,
): Promise<void> {
  const reader = new SocketReader(client);
  try {
    const { host, port, scheme } = await acceptAuthenticatedConnect(
      reader,
      client,
      expectedPassword,
    );
    const destination = new URL(`${scheme}://${formatHost(host)}:${port}/`);
    const resolution = await resolveProxy(destination.href);
    const remote = await connectByResolvedRoute(
      parseProxyRoutes(resolution),
      host,
      port,
    );
    reader.dispose();
    client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
    pipeSockets(client, remote);
  } catch {
    reader.dispose();
    if (!client.destroyed) {
      try {
        client.write(
          Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        );
      } catch {
        // The client may have closed while the route was being resolved.
      }
      client.destroy();
    }
  }
}

async function acceptAuthenticatedConnect(
  reader: SocketReader,
  client: Socket,
  expectedPassword: string,
): Promise<{ host: string; port: number; scheme: "http" | "https" }> {
  const hello = await reader.readExact(2);
  if (hello[0] !== 0x05 || hello[1] === 0) {
    throw new Error("invalid SOCKS5 greeting");
  }
  const methods = await reader.readExact(hello[1]);
  if (!methods.includes(0x02)) {
    client.write(Buffer.from([0x05, 0xff]));
    throw new Error("SOCKS5 authentication is required");
  }
  client.write(Buffer.from([0x05, 0x02]));

  const auth = await reader.readExact(2);
  if (auth[0] !== 0x01 || auth[1] === 0) {
    throw new Error("invalid SOCKS5 authentication frame");
  }
  const usernameBytes = await reader.readExact(auth[1]);
  const passwordLength = await reader.readExact(1);
  if (passwordLength[0] === 0) throw new Error("empty SOCKS5 password");
  const passwordBytes = await reader.readExact(passwordLength[0]);
  const username = usernameBytes.toString("utf8");
  const suppliedPassword = passwordBytes.toString("utf8");
  const passwordMatches = secureEqual(suppliedPassword, expectedPassword);
  const usernameAllowed =
    username === "system-auto" ||
    username === "system-http" ||
    username === "system-https";
  client.write(Buffer.from([0x01, passwordMatches && usernameAllowed ? 0x00 : 0x01]));
  if (!passwordMatches || !usernameAllowed) {
    throw new Error("SOCKS5 authentication failed");
  }

  const header = await reader.readExact(4);
  if (header[0] !== 0x05 || header[1] !== 0x01) {
    throw new Error("only SOCKS5 CONNECT is supported");
  }
  const host = await readSocksAddress(reader, header[3]);
  const portBytes = await reader.readExact(2);
  const port = portBytes.readUInt16BE(0);
  if (port === 0) throw new Error("invalid SOCKS5 destination port");
  const scheme =
    username === "system-http" ||
    (username === "system-auto" && port === 80)
      ? "http"
      : "https";
  return { host, port, scheme };
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function readSocksAddress(
  reader: SocketReader,
  addressType: number,
): Promise<string> {
  if (addressType === 0x01) {
    return [...(await reader.readExact(4))].join(".");
  }
  if (addressType === 0x03) {
    const length = await reader.readExact(1);
    return (await reader.readExact(length[0])).toString("utf8");
  }
  if (addressType === 0x04) {
    const bytes = await reader.readExact(16);
    const parts: string[] = [];
    for (let index = 0; index < 16; index += 2) {
      parts.push(bytes.readUInt16BE(index).toString(16));
    }
    return parts.join(":");
  }
  throw new Error("invalid SOCKS5 destination address type");
}

function parseProxyRoutes(value: string): ProxyRoute[] {
  if (value.length > MAX_PROXY_RESOLUTION_LENGTH) {
    throw new Error("system proxy resolution is too large");
  }
  const routes: ProxyRoute[] = [];
  for (const candidate of value.split(";")) {
    const [kind, endpoint] = candidate.trim().split(/\s+/, 2);
    if (!kind) continue;
    const normalized = kind.toUpperCase();
    if (normalized === "DIRECT") {
      routes.push({ kind: "direct" });
      continue;
    }
    const scheme =
      normalized === "PROXY" || normalized === "HTTP"
        ? "http"
        : normalized === "HTTPS"
          ? "https"
          : normalized === "SOCKS" || normalized === "SOCKS5"
            ? "socks5"
            : null;
    if (!scheme || !endpoint) continue;
    const parsed = parseProxyUrl(`${scheme}://${endpoint}`);
    if (parsed.ok) routes.push({ kind: "proxy", proxy: parsed.value });
  }
  if (routes.length === 0) throw new Error("system proxy returned no usable route");
  return routes;
}

async function connectByResolvedRoute(
  routes: ProxyRoute[],
  host: string,
  port: number,
): Promise<Socket> {
  let lastError: unknown;
  for (const route of routes) {
    try {
      return route.kind === "direct"
        ? await connectTcp(host, port)
        : await connectViaProxy(route.proxy, host, port);
    } catch (error) {
      if (isProxyPolicyRejection(error)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("system proxy routes could not connect");
}

function isProxyPolicyRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /HTTP proxy CONNECT failed \(HTTP\/\d(?:\.\d)?\s+4\d\d\b/i.test(
      error.message,
    ) || error.message === "SOCKS5: authentication failed"
  );
}

function pipeSockets(left: Socket, right: Socket): void {
  const closeBoth = () => {
    left.destroy();
    right.destroy();
  };
  left.once("error", closeBoth);
  right.once("error", closeBoth);
  left.once("close", () => right.destroy());
  right.once("close", () => left.destroy());
  left.pipe(right);
  right.pipe(left);
}

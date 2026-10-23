import { createServer } from "vite";
import { electronShellFixture } from "./native-session-electron-hook.mjs";

/** Load real Main modules without OS effects or unused development watchers. */
export function createMainTestServer(config) {
  return createServer({
    ...config,
    server: { ...config.server, watch: null },
    ssr: { ...config.ssr, noExternal: ["electron"] },
    plugins: [electronShellFixture(), ...(config.plugins ?? [])],
  });
}

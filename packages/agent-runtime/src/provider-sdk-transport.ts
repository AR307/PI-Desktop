import { AsyncLocalStorage } from "node:async_hooks";
import type { FetchFunction, SimpleStreamOptions } from "@earendil-works/pi-ai";

const requestFetch = new AsyncLocalStorage<FetchFunction | undefined>();
let installed: typeof fetch | undefined;

/** Google GenAI uses global fetch and rejects pi's per-request fetch option.
 * Scope the existing transport to its async request without mixing sessions.
 */
export function withGoogleTransport<T>(options: SimpleStreamOptions, start: (options: SimpleStreamOptions) => T): T {
  if (!options.fetch) return start(options);
  if (globalThis.fetch !== installed) {
    const base = globalThis.fetch;
    installed = (input, init) => {
      const scoped = requestFetch.getStore();
      // The captured transport can itself call global fetch. Clear this scope
      // during dispatch so it reaches the proxy-aware base exactly once.
      return scoped
        ? requestFetch.run(undefined, () => scoped(input, init))
        : base(input, init);
    };
    globalThis.fetch = installed;
  }
  const { fetch: transport, ...sdkOptions } = options;
  return requestFetch.run(transport, () => start(sdkOptions));
}

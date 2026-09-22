import type { ImageEndpoint } from "@pi-desktop/agent-runtime";

/** Local relay base plus `/v1`, so the upstream client appends `/images/generations` or `/images/edits`. */
export function mirrorImageBatchRequest(input: {
  baseUrl: string;
  modelId: string;
  relayKey: string;
  prompt: string;
  count: number;
  images?: string[];
}): {
  input: { items: Array<{ prompt: string; count: number; images?: string[] }> };
  endpoint: ImageEndpoint;
} {
  return {
    input: {
      items: [{
        prompt: input.prompt,
        count: input.count,
        ...(input.images?.length ? { images: input.images } : {}),
      }],
    },
    endpoint: {
      baseUrl: `${input.baseUrl.replace(/\/+$/, "")}/v1`,
      modelId: input.modelId,
      headers: { "x-pi-mirrorcoding-key": input.relayKey },
    },
  };
}

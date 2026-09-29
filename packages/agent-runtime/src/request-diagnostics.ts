import type { ResponseDiagnostics } from "@pi-desktop/shared";

export type RequestDiagnostics = Pick<
  ResponseDiagnostics,
  "path" | "model" | "reasoning" | "outputLimit"
>;

/** MC strips the provider-scoped loopback prefix before forwarding upstream. */
export function upstreamRequestDiagnostics(
  request: RequestDiagnostics,
  provider: { id: string; authKind?: string },
): RequestDiagnostics {
  const prefix = "/" + provider.id;
  return provider.authKind === "mirrorcoding" && request.path?.startsWith(prefix + "/")
    ? { ...request, path: request.path.slice(prefix.length) }
    : request;
}

/** Extract only approved scalar fields from the final HTTP payload. */
export function requestDiagnostics(
  input: RequestInfo | URL,
  init?: RequestInit,
): RequestDiagnostics {
  const result: RequestDiagnostics = {};
  try {
    result.path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  } catch {
    /* Unknown transport; no invented path. */
  }
  if (typeof init?.body !== "string") return result;
  let raw: unknown;
  try {
    raw = JSON.parse(init.body);
  } catch {
    return result;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  const payload = raw as Record<string, unknown>;
  if (typeof payload.model === "string") result.model = payload.model;
  for (const key of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) result.outputLimit = value;
  }
  const reasoning: NonNullable<ResponseDiagnostics["reasoning"]> = {};
  const generation = payload.generationConfig;
  if (generation && typeof generation === "object" && !Array.isArray(generation)) {
    const config = generation as Record<string, unknown>;
    if (typeof config.maxOutputTokens === "number" && Number.isFinite(config.maxOutputTokens)) {
      result.outputLimit = config.maxOutputTokens;
    }
    const thinking = config.thinkingConfig;
    if (thinking && typeof thinking === "object" && !Array.isArray(thinking)) {
      for (const key of ["thinkingLevel", "thinkingBudget", "includeThoughts"]) {
        const value = (thinking as Record<string, unknown>)[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          reasoning[`generationConfig.thinkingConfig.${key}`] = value;
        }
      }
    }
  }
  if (typeof payload.reasoning_effort === "string")
    reasoning.reasoning_effort = payload.reasoning_effort;
  for (const [parent, keys] of [
    ["thinking", ["type", "budget_tokens"]],
    ["output_config", ["effort"]],
    ["reasoning", ["effort", "summary"]],
  ] as const) {
    const value = payload[parent];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const key of keys) {
      const scalar = (value as Record<string, unknown>)[key];
      if (typeof scalar === "string" || typeof scalar === "number" || typeof scalar === "boolean")
        reasoning[`${parent}.${key}`] = scalar;
    }
  }
  if (Object.keys(reasoning).length) result.reasoning = reasoning;
  return result;
}

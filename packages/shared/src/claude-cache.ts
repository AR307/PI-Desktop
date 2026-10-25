/** Claude prompt caching is configured on the Anthropic Messages wire. */
export function isClaudeModel(modelId: string, family?: string): boolean {
  return /claude/i.test(modelId) || /claude/i.test(family ?? "");
}

export function supportsClaudeCacheTtl(modelId: string, apiStyle?: string, family?: string): boolean {
  return isClaudeModel(modelId, family) &&
    (!apiStyle || apiStyle === "auto" || apiStyle === "anthropic_messages" || apiStyle === "anthropic-messages");
}

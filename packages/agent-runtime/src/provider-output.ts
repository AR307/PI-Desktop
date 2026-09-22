/** Includes tool-call fragments, which can arrive before visible assistant text. */
export function hasAssistantOutput(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((raw: unknown) => {
    if (!raw || typeof raw !== "object") return false;
    const block = raw as Record<string, unknown>;
    return (block.type === "text" && typeof block.text === "string" && block.text.length > 0)
      || (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0)
      || block.type === "toolCall";
  });
}

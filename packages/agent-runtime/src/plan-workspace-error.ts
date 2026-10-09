/** Missing workspace is recoverable without approving or executing a contract. */
export function planWorkspaceRequiredResult(error: unknown) {
  if (
    typeof error !== "object" ||
    error === null ||
    !("data" in error) ||
    typeof error.data !== "object" ||
    error.data === null ||
    !("errorCode" in error.data) ||
    error.data.errorCode !== "PLAN_WORKSPACE_REQUIRED"
  )
    return undefined;

  return {
    content: [
      {
        type: "text" as const,
        text: "A project workspace is required for Plan/Goal approval. Bind this session to a project workspace before retrying. Explain the limitation and present the proposal in chat for now; do not retry submission until a workspace is bound. No approval was created and execution is not authorized.",
      },
    ],
    details: { errorCode: "PLAN_WORKSPACE_REQUIRED" },
    isError: true,
  };
}

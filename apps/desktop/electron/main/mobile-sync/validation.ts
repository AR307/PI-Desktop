import { RacpError } from "@pi-desktop/agent-host";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RacpError("INVALID_ARGUMENT", "invalid_object");
  }
  return value as Record<string, unknown>;
}

export function string(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new RacpError("INVALID_ARGUMENT", `invalid_${field}`);
  }
  return value;
}

export function integer(
  value: unknown,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new RacpError("INVALID_ARGUMENT", `invalid_${field}`);
  }
  return value;
}

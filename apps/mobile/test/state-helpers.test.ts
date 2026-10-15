import { describe, expect, it } from "vitest";
import type { UiMessage } from "@pi-desktop/shared";
import { isConnectivityError } from "../src/state/errors";
import { latestTopLevelMessageId } from "../src/state/selectors";

describe("latest top-level message", () => {
  const rows: UiMessage[] = [
    { id: "user", role: "user", content: "hi", createdAt: "1" },
    { id: "answer", role: "assistant", content: "ok", createdAt: "2" },
    { id: "tool", role: "tool", content: "", createdAt: "3" },
    { id: "child", role: "assistant", content: "delegate", createdAt: "4", parentToolCallId: "task" },
  ];

  it("skips tool and delegate rows", () => {
    expect(latestTopLevelMessageId(rows)).toBe("answer");
    expect(latestTopLevelMessageId([])).toBeUndefined();
  });

  it("scans a transcript array only once however many rows ask", () => {
    let reads = 0;
    const counted = new Proxy([...rows], { get(target, key, receiver) { if (typeof key === "string" && /^\d+$/.test(key)) reads += 1; return Reflect.get(target, key, receiver); } });
    for (let index = 0; index < 600; index += 1) latestTopLevelMessageId(counted);
    expect(reads).toBe(3);
  });
});

describe("connectivity failures", () => {
  it("treats platform fetch and relay connection failures as offline state", () => {
    expect(isConnectivityError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isConnectivityError(new TypeError("Load failed"))).toBe(true);
    expect(isConnectivityError(new DOMException("signal timed out", "TimeoutError"))).toBe(true);
    expect(isConnectivityError(new Error("Relay connection failed"))).toBe(true);
    expect(isConnectivityError(new Error("Relay connection timed out"))).toBe(true);
  });

  it("keeps programming and service errors reportable", () => {
    expect(isConnectivityError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isConnectivityError(new Error("RATE_LIMITED"))).toBe(false);
    expect(isConnectivityError(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(isConnectivityError("Failed to fetch")).toBe(false);
  });
});

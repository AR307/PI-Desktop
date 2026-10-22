import { afterEach, describe, expect, it, vi } from "vitest";
import { Type } from "typebox";
import type { AgentEventEnvelope } from "@pi-desktop/shared";
import { DesktopAgentRuntime } from "./runtime.js";
import { SubagentRun } from "./subagent.js";
import { completeOneShot } from "./one-shot-complete.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

const provider: RuntimeProviderConfig = {
  id: "fixture",
  name: "Fixture",
  modelId: "fixture-model",
  baseUrl: "http://provider.invalid/v1",
  apiKey: "fixture-only",
  apiStyle: "chat_completions",
  supportsReasoning: false,
  supportedThinkingLevels: ["off"],
};

type Failure = "network" | "rate-limit" | "stream" | "timeout";
type Step = Failure | "tool" | "success" | "partial-stream" | "partial-timeout" | "thinking-stream" | "thinking-only" | "length" | "empty" | "stalled" | "unauthorized";

/** Real provider adapter and agent loop; replace only fetch and the host edge. */
function fixture(steps: Step[], infiniteProviderRetry = false, signal?: AbortSignal) {
  let requests = 0;
  let reads = 0;
  const events: AgentEventEnvelope[] = [];
  const bodies: string[] = [];
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    bodies.push(String(init?.body));
    const step = steps[requests++];
    if (!step) throw new Error("Unexpected provider request");
    if (step === "network") throw new TypeError("fetch failed");
    if (step === "timeout") throw Object.assign(new Error("Connection timed out"), { name: "TimeoutError" });
    if (step === "unauthorized") return new Response("Invalid API key", { status: 401 });
    if (step === "rate-limit")
      return new Response("Rate limited", {
        status: 429,
        headers: { "retry-after-ms": "1" },
      });
    const delta =
      step === "tool"
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call_${requests}`,
                type: "function",
                function: { name: "Read", arguments: '{"path":"fixture.txt"}' },
              },
            ],
          }
        : ["thinking-only", "thinking-stream"].includes(step) ? { role: "assistant", reasoning_content: "Retained thinking" }
        : { role: "assistant", content: ["stream", "empty"].includes(step) ? "" : step.startsWith("partial-") ? "partial" : "Recovered" };
    const chunk = (value: unknown, finish: string | null) =>
      `data: ${JSON.stringify({ id: "completion", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
    if (["stream", "partial-stream", "thinking-stream", "partial-timeout", "stalled"].includes(step)) {
      let sent = false;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            if (step === "stalled") init?.signal?.addEventListener("abort", () => controller.error(new Error("connection closed")), { once: true });
          },
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(new TextEncoder().encode(chunk(delta, null)));
            } else if (step !== "stalled") controller.error(new Error(step === "partial-timeout" ? "upstream request timeout" : "Upstream response stream was interrupted (code: upstream_stream_read_error)"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    return new Response(
      chunk(delta, null) +
        chunk({}, step === "tool" ? "tool_calls" : step === "length" ? "length" : "stop") +
        "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  vi.stubGlobal("fetch", fetch);
  const runtime = new DesktopAgentRuntime({
    sessionId: "fixture-session",
    mode: "agent",
    provider,
    thinkingLevel: "off",
    infiniteProviderRetry,
    commandShell: {
      id: "bash",
      label: "Bash",
      dialect: "posix",
      available: true,
      isDefault: true,
    },
    host: {
      async call<T>(method: string): Promise<T> {
        if (method === "session.appendMessage") return undefined as T;
        if (method !== "tools.execute")
          throw new Error(`Unexpected host method: ${method}`);
        reads++;
        return { ok: true, content: "fixture contents" } as T;
      },
    },
    onEvent: (event) => events.push(event),
  });
  const subagent = new SubagentRun({
    definition: {
      name: "fixture",
      description: "Read fixture",
      prompt: "Read fixture",
      source: "builtin",
      tools: ["Read"],
    },
    sessionId: "fixture-session",
    parentToolCallId: "task",
    task: "Read fixture",
    provider,
    thinkingLevel: "off",
    infiniteProviderRetry,
    signal,
    systemPrompt: "Read and report",
    tools: [
      {
        name: "Read",
        label: "Read",
        description: "Read fixture",
        parameters: Type.Object({ path: Type.String() }),
        execute: async () => {
          reads++;
          return { content: [{ type: "text", text: "fixture contents" }], details: {} };
        },
      },
    ],
    onEvent: (event) => events.push(event),
  });
  return { runtime, subagent, events, bodies, requests: () => requests, reads: () => reads };
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  // Attach handlers before advancing clocks so expected terminal rejections
  // never become unhandled rejections in the test process.
  const observed = promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  void observed.then(() => {
    settled = true;
  });
  for (let tick = 0; tick < 180 && !settled; tick++)
    await vi.advanceTimersByTimeAsync(1000);
  expect(settled, "run settles inside the bounded recovery window").toBe(true);
  const result = await observed;
  if ("error" in result) throw result.error;
  return result.value;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("recovery boundaries across request owners", () => {
  for (const owner of ["session", "subagent", "one-shot"] as const) {
    const start = (f: ReturnType<typeof fixture>, signal?: AbortSignal): Promise<unknown> => owner === "session"
      ? f.runtime.prompt("Finish the report.") : owner === "subagent" ? f.subagent.run()
      : completeOneShot(provider, { messages: [{ role: "user", content: "Report.", timestamp: 1 }] }, "off", { signal });

    it(`${owner} recovers a stalled partial stream rather than hanging or stopping`, async () => {
      vi.useFakeTimers();
      vi.stubEnv("PI_DESKTOP_STREAM_IDLE_TIMEOUT_MS", "30000");
      const f = fixture(["stalled", "success"]);
      try {
        const result = await settle(start(f));
        expect(f.requests()).toBe(2);
        if (owner === "one-shot") expect(result).toMatchObject({ text: "Recovered" });
        else expect(f.events.some(e => e.event.type === "message_end" && e.event.message.status === "complete" && e.event.message.content === "Recovered")).toBe(true);
      } finally { await f.runtime.dispose(); }
    });

    it(`${owner} cancels a partial-stream recovery without another request`, async () => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const f = fixture(["partial-timeout"], false, controller.signal);
      try {
        const running = start(f, controller.signal).catch(error => error);
        await vi.advanceTimersByTimeAsync(0);
        expect(f.requests()).toBe(1);
        controller.abort();
        if (owner === "session") await f.runtime.abort();
        await settle(running);
        await vi.advanceTimersByTimeAsync(60000);
        expect(f.requests()).toBe(1);
        expect(f.events.some(e => e.event.type === "error" && e.event.error.code === "STREAM_FAILED")).toBe(false);
        if (owner === "session") expect(f.events.filter(e => e.event.type === "agent_end")).toHaveLength(1);
      } finally { await f.runtime.dispose(); }
    });

    it(`${owner} keeps unauthorized requests terminal`, async () => {
      vi.useFakeTimers();
      const f = fixture(["unauthorized"]);
      try {
        await settle(start(f).catch(error => error));
        expect(f.requests()).toBe(1);
      } finally { await f.runtime.dispose(); }
    });

    it(`${owner} shares its finite budget across partial streams and setup failures`, async () => {
      vi.useFakeTimers();
      const f = fixture(Array.from({ length: 11 }, (_, index) => index % 2 ? "timeout" : "partial-stream"));
      try {
        await settle(start(f).catch(error => error));
        expect(f.requests()).toBe(11);
        expect(f.reads()).toBe(0);
        if (owner === "session") expect(f.events.filter(e => e.event.type === "agent_end")).toHaveLength(1);
      } finally { await f.runtime.dispose(); }
    });
  }

  for (const owner of ["session", "subagent"] as const) {
    it(`${owner} replenishes recovery only after successful tool progress, not partial output`, async () => {
      vi.useFakeTimers();
      const f = fixture([
        ...Array.from({ length: 11 }, (): Step[] => ["partial-stream", "tool"]).flat(),
        "partial-timeout", "success",
      ]);
      try {
        if (owner === "session") await settle(f.runtime.prompt("Read repeatedly then report."));
        else expect((await settle(f.subagent.run())).status).toBe("completed");
        expect(f.reads()).toBe(11);
        expect(f.requests()).toBe(24);
        expect(f.events.filter(e => e.event.type === "error")).toHaveLength(0);
      } finally { await f.runtime.dispose(); }
    });

    it(`${owner} honors infinite retry after partial content beyond the finite budget`, async () => {
      vi.useFakeTimers();
      const f = fixture([...Array<Step>(12).fill("partial-stream"), "success"], true);
      try {
        if (owner === "session") await settle(f.runtime.prompt("Report."));
        else expect((await settle(f.subagent.run())).status).toBe("completed");
        expect(f.requests()).toBe(13);
        expect(f.events.filter(e => e.event.type === "error")).toHaveLength(0);
      } finally { await f.runtime.dispose(); }
    });
  }
});

describe("provider recovery through real agent loops (#699)", () => {
  for (const owner of ["session", "subagent"] as const) {
    for (const failure of ["network", "rate-limit", "stream", "timeout"] as const) {
      it(`${owner} recovers independent ${failure} outages across eleven successful tool rounds`, async () => {
        vi.useFakeTimers();
        const f = fixture([
          ...Array.from({ length: 11 }, (): Step[] => [failure, "tool"]).flat(),
          failure,
          "success",
        ]);
        try {
          if (owner === "session")
            await settle(f.runtime.prompt("Read repeatedly, then report."));
          else expect((await settle(f.subagent.run())).status).toBe("completed");
          expect(f.reads()).toBe(11);
          expect(f.requests()).toBe(24);
          expect(f.events.filter((e) => e.event.type === "error")).toHaveLength(0);
          expect(
            f.events.some(
              (e) =>
                e.event.type === "message_end" &&
                e.event.message.content === "Recovered" &&
                e.event.message.status === "complete",
            ),
          ).toBe(true);
          if (owner === "session") {
            const retryAttempts = f.events.flatMap((e) =>
              e.event.type === "status" && e.event.status.activity?.phase === "retrying"
                ? [e.event.status.activity.attempt]
                : [],
            );
            expect(retryAttempts).toEqual(Array(12).fill(1));
          }
        } finally {
          await f.runtime.dispose();
        }
      });
    }
  }

  it("keeps failures bounded after a recovered tool response and reports the exhausted budget", async () => {
    vi.useFakeTimers();
    const f = fixture(["network", "tool", ...Array<Step>(11).fill("network")]);
    try {
      await settle(f.runtime.prompt("Read, then report."));
      expect(f.reads()).toBe(1);
      expect(f.requests()).toBe(13);
      const errors = f.events.filter((e) => e.event.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]?.event).toMatchObject({
        type: "error",
        error: { code: "NETWORK_ERROR", details: { retryAttempt: 10 } },
      });
      expect(f.events.filter((e) => e.event.type === "agent_end")).toHaveLength(1);
    } finally {
      await f.runtime.dispose();
    }
  });

  for (const owner of ["session", "subagent"] as const) {
    it(`${owner} does not replenish the budget on empty stream activity or a phase change`, async () => {
      vi.useFakeTimers();
      const f = fixture(
        Array.from({ length: 11 }, (_, i): Step => (i % 2 ? "stream" : "network")),
      );
      try {
        if (owner === "session") {
          await settle(f.runtime.prompt("Report."));
          expect(f.events.filter((e) => e.event.type === "error")).toEqual([
            expect.objectContaining({
              event: expect.objectContaining({
                error: expect.objectContaining({
                  details: expect.objectContaining({ retryAttempt: 10 }),
                }),
              }),
            }),
          ]);
        } else expect((await settle(f.subagent.run())).status).toBe("failed");
        expect(f.requests()).toBe(11);
        expect(f.reads()).toBe(0);
      } finally {
        await f.runtime.dispose();
      }
    });
  }

  it("cancels the retry wait without opening another provider request", async () => {
    vi.useFakeTimers();
    const f = fixture(["network"]);
    try {
      const prompt = f.runtime.prompt("Report.").catch((error) => error);
      await vi.waitFor(() =>
        expect(
          f.events.some(
            (e) =>
              e.event.type === "status" && e.event.status.activity?.phase === "retrying",
          ),
        ).toBe(true),
      );
      await f.runtime.abort();
      await settle(prompt);
      await vi.advanceTimersByTimeAsync(10000);
      expect(f.requests()).toBe(1);
      expect(f.events.filter((e) => e.event.type === "agent_end")).toHaveLength(1);
      expect(
        f.events.some(
          (e) => e.event.type === "error" && e.event.error.code === "NETWORK_ERROR",
        ),
      ).toBe(false);
    } finally {
      await f.runtime.dispose();
    }
  });
});


describe("non-destructive completion recovery through real provider adapters", () => {
  for (const owner of ["session", "subagent"] as const) {
    for (const [step, code] of [["thinking-only", "MODEL_THINKING_ONLY"], ["length", "MODEL_OUTPUT_TRUNCATED"]] as const) {
      it(owner + " keeps " + step + " without replay", async () => {
        const f = fixture([step]);
        try {
          if (owner === "session") await f.runtime.prompt("Report.");
          else expect((await f.subagent.run()).status).toBe("failed");
          expect(f.requests()).toBe(1);
          const ended = f.events.flatMap(e => e.event.type === "message_end" && e.event.message.role === "assistant" ? [e.event.message] : []);
          expect(ended.at(-1)).toMatchObject({ status: "error", error: { code }, responseDiagnostics: { end: step === "length" ? "truncated" : "thinking-only" } });
          expect(ended.at(-1)?.thinking || ended.at(-1)?.content).toBeTruthy();
          expect(f.reads()).toBe(0);
        } finally { await f.runtime.dispose(); }
      });
    }
    for (const failure of ["partial-stream", "partial-timeout", "thinking-stream"] as const) {
      it(`${owner} automatically continues ${failure} after a completed tool without losing output or repeating the tool`, async () => {
        vi.useFakeTimers();
        const f = fixture(["tool", failure, "network", failure, "success"]);
        try {
          if (owner === "session") await settle(f.runtime.prompt("Read then finish the report."));
          else expect((await settle(f.subagent.run())).status).toBe("completed");
          expect(f.requests()).toBe(5);
          expect(f.reads()).toBe(1);
          expect(f.events.filter(e => e.event.type === "error")).toHaveLength(0);
          const ended = f.events.flatMap(e => e.event.type === "message_end" ? [e.event.message] : []);
          expect(ended.filter(m => m.status === "error")).toHaveLength(0);
          expect(ended.at(-1)).toMatchObject({ content: "Recovered", status: "complete" });
          expect(ended.some(m => failure === "thinking-stream" ? m.thinking === "Retained thinking" : m.content === "partial")).toBe(true);
          const finalContext = JSON.parse(f.bodies.at(-1) ?? "{}").messages;
          expect(finalContext.filter((m: { role: string }) => m.role === "tool")).toHaveLength(1);
          expect(JSON.stringify(finalContext)).toContain("fixture contents");
          if (failure !== "thinking-stream") expect(JSON.stringify(finalContext)).toContain("partial");
          if (owner === "session") expect(f.events.filter(e => e.event.type === "agent_end")).toHaveLength(1);
        } finally { await f.runtime.dispose(); }
      });
    }
    it(owner + " retries an empty response only once", async () => {
      vi.useFakeTimers();
      const f = fixture(["empty", "empty"]);
      try {
        if (owner === "session") await settle(f.runtime.prompt("Report."));
        else expect((await settle(f.subagent.run())).status).toBe("failed");
        expect(f.requests()).toBe(2);
        expect(f.events.some(e => e.event.type === "message_end" && e.event.message.error?.code === "EMPTY_MODEL_RESPONSE")).toBe(true);
        const final = f.events.flatMap(e => e.event.type === "message_end" ? [e.event.message] : []).at(-1);
        expect(final?.responseDiagnostics?.attempts).toBe(2);
      } finally { await f.runtime.dispose(); }
    });
  }
});

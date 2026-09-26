import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { MirrorCodingRelay } = await import("../electron/main/mirrorcoding/relay.ts");
const { ImageTasks } = await import("../../../packages/agent-runtime/src/images.ts");

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9mQAAAAASUVORK5CYII=";

/** The documented MirrorCoding image capability for a GPT-Image style model. */
const capability = {
  generation_path: "/v1/images/generations",
  reference_path: "/v1/images/edits",
  sizes: ["1024x1024"],
  qualities: ["high"],
  max_count: 3,
  supports_chat: false,
};

const metadata = {
  scope: "group",
  accountId: 901,
  groupId: "g-images",
  groupName: "Images",
  description: "",
  ratio: 0.06,
  dynamicBilling: false,
  routes: {},
  imageRoutes: {
    "gpt-image-1": { generation: "image-generation", reference: "image-edit" },
    "text-image": { generation: "image-generation" },
  },
  imageCapabilities: {
    "gpt-image-1": {
      generationPath: "/v1/images/generations",
      referencePath: "/v1/images/edits",
      maxCount: 3,
      supportsChat: false,
    },
    "text-image": { generationPath: "/v1/images/generations", maxCount: 1, supportsChat: false },
  },
  imageModels: {
    "gpt-image-1": capability,
    "text-image": { generation_path: "/v1/images/generations", max_count: 1, supports_chat: false },
  },
};

const catalog = {
  user: { id: 901, displayName: "QA" },
  groups: [{
    id: "g-images",
    name: "Images",
    description: "",
    ratio: 0.06,
    dynamicBilling: false,
    models: [
      {
        id: "gpt-image-1",
        supportedEndpointTypes: ["image-generation", "image-edit"],
        image: {
          generationPath: "/v1/images/generations",
          referencePath: "/v1/images/edits",
          sizes: ["1024x1024"],
          qualities: ["high"],
          maxCount: 3,
          supportsChat: false,
        },
      },
      {
        id: "text-image",
        supportedEndpointTypes: ["image-generation"],
        image: { generationPath: "/v1/images/generations", maxCount: 1, supportsChat: false },
      },
    ],
  }],
  supportedEndpoints: {
    "image-generation": { path: "/v1/images/generations", method: "POST" },
    "image-edit": { path: "/v1/images/edits", method: "POST" },
  },
};

/** Upstream MirrorCoding double: the only mocked boundary in these tests. */
function fakeAccount() {
  const upstream = [];
  return {
    upstream,
    snapshot: () => ({
      status: "connected",
      sync: "success",
      pendingRevocation: false,
      account: catalog.user,
      catalog,
    }),
    async request(path, init) {
      const raw = init.body;
      const body = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
      upstream.push({
        path,
        contentType: new Headers(init.headers).get("content-type") ?? "",
        group: new Headers(init.headers).get("x-mirrorcoding-group") ?? "",
        body,
      });
      return new Response(
        JSON.stringify({ data: [{ b64_json: PNG_B64, mime_type: "image/png" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
    async groupUnavailable() {},
  };
}

test("image edits reach MirrorCoding as JSON references through the relay", async () => {
  const account = fakeAccount();
  const relay = new MirrorCodingRelay(account);
  try {
    const bound = await relay.bindImage("prov-1", metadata, "gpt-image-1", "session-1", false, "g-images");
    const tasks = new ImageTasks();
    const result = await tasks.generate({
      jobId: "job-edit",
      prompt: "Edit both references",
      options: { count: 1 },
      binding: {
        model: {
          providerId: "prov-1",
          modelId: "gpt-image-1",
          displayName: "gpt-image-1",
          groupName: "Images",
          description: "",
          ratio: 0.06,
          dynamicBilling: false,
          capability,
        },
        baseUrl: bound.baseUrl,
        headers: bound.headers,
        references: [
          { data: PNG_B64, mimeType: "image/png" },
          { data: PNG_B64, mimeType: "image/png" },
        ],
      },
    });
    assert.equal(result.outputs.length, 1);
    assert.equal(account.upstream.length, 1);
    const call = account.upstream[0];
    assert.equal(call.path, "/v1/images/edits");
    assert.match(call.contentType, /application\/json/);
    assert.equal(call.group, encodeURIComponent("g-images"));
    const payload = JSON.parse(call.body);
    assert.equal(payload.model, "gpt-image-1");
    assert.equal(payload.n, 1);
    assert.equal(payload.images.length, 2);
    assert.ok(payload.images.every((ref) => ref.image_url.startsWith(`data:image/png;base64,${PNG_B64.slice(0, 8)}`)));
  } finally {
    relay.dispose();
  }
});

test("the relay rejects multipart edits bodies instead of forwarding them", async () => {
  const account = fakeAccount();
  const relay = new MirrorCodingRelay(account);
  try {
    const bound = await relay.bindImage("prov-1", metadata, "gpt-image-1", "session-1", false, "g-images");
    const form = new FormData();
    form.set("model", "gpt-image-1");
    form.set("prompt", "Edit");
    form.append("image", new Blob([Buffer.from(PNG_B64, "base64")], { type: "image/png" }), "ref-1");
    const response = await fetch(`${bound.baseUrl}/v1/images/edits`, {
      method: "POST",
      headers: bound.headers,
      body: form,
    });
    assert.equal(response.status, 403);
    assert.equal(account.upstream.length, 0);
  } finally {
    relay.dispose();
  }
});

test("the relay refuses JSON references for a model without a reference route", async () => {
  const account = fakeAccount();
  const relay = new MirrorCodingRelay(account);
  try {
    const bound = await relay.bindImage("prov-1", metadata, "text-image", "session-1", false, "g-images");
    const response = await fetch(`${bound.baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: { ...bound.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "text-image",
        prompt: "no references supported",
        n: 1,
        images: [{ image_url: `data:image/png;base64,${PNG_B64}` }],
      }),
    });
    assert.equal(response.status, 403);
    assert.equal(account.upstream.length, 0);
  } finally {
    relay.dispose();
  }
});

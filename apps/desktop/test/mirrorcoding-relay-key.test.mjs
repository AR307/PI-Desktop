import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { relayBindingKey } = await import("../electron/main/mirrorcoding/relay-key.ts");

test("relay accepts its explicit local binding header", () => {
  assert.equal(
    relayBindingKey({ "x-pi-mirrorcoding-key": "local-key" }),
    "local-key",
  );
});

test("relay accepts adapter auth headers as local binding carriers", () => {
  assert.equal(relayBindingKey({ authorization: "Bearer local-key" }), "local-key");
  assert.equal(relayBindingKey({ "x-api-key": "local-key" }), "local-key");
  assert.equal(relayBindingKey({ "api-key": "local-key" }), "local-key");
  assert.equal(relayBindingKey({ "x-goog-api-key": "local-key" }), "local-key");
});

test("relay does not treat malformed authorization as a binding", () => {
  assert.equal(relayBindingKey({ authorization: "Basic local-key" }), undefined);
  assert.equal(relayBindingKey({ authorization: ["Bearer local-key"] }), undefined);
  assert.equal(relayBindingKey({ "x-goog-api-key": ["local-key"] }), undefined);
  assert.equal(relayBindingKey({ "x-goog-api-key": "" }), undefined);
});

test("explicit relay credentials take precedence over adapter credentials", () => {
  assert.equal(relayBindingKey({
    "x-pi-mirrorcoding-key": "explicit-key",
    "x-goog-api-key": "different-key",
  }), "explicit-key");
});

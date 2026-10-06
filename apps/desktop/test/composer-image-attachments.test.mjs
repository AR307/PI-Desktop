import assert from "node:assert/strict";
import test from "node:test";
import {
  attachImageTokens,
  detachImageTokens,
} from "../src/features/chat/composer/image-attachments.ts";

const image = { id: "image", sessionId: "a", path: "/scratch/a.png", name: "a.png", kind: "image", token: "\ue001" };
const tokenlessImage = { id: "inline", sessionId: "a", path: "/scratch/b.png", name: "b.png", kind: "image" };
const file = { id: "file", sessionId: "a", path: "/scratch/a.txt", name: "a.txt", kind: "file", token: "\ue002" };

test("submission detaches image tokens and image references while text keeps file order", () => {
  const result = detachImageTokens(`before ${image.token}${file.token} after`, [image, file], 9);
  assert.equal(result.text, `before ${file.token} after`);
  assert.equal(result.caret, 8);
  const { token, ...detachedImage } = image;
  assert.deepEqual(result.references, [detachedImage, file]);
  assert.equal(image.token, "\ue001");
});

test("image-only drafts keep metadata and a valid empty-text caret", () => {
  const result = detachImageTokens(image.token, [image], 1);
  assert.equal(result.text, "");
  assert.equal(result.caret, 0);
  assert.equal(result.references[0].path, image.path);
  assert.equal(result.references[0].token, undefined);
});

test("MIME image references detach without changing earlier text or repeated normalization", () => {
  const result = detachImageTokens(`abc${image.token}def${image.token}`, [{ ...image, kind: "file", mimeType: "IMAGE/PNG" }], 2);
  assert.equal(result.text, "abcdef");
  assert.equal(result.caret, 2);
  assert.deepEqual(detachImageTokens(result.text, result.references, result.caret), result);
});

test("a restored image without a token becomes an inline chip", () => {
  const { text, references } = attachImageTokens(`look${file.token} here`, [tokenlessImage, file], () => "\ue101");
  assert.equal(text, `look${file.token} here\ue101`);
  assert.equal(references[0].token, "\ue101");
  assert.equal(references[0].path, tokenlessImage.path);
  assert.equal(tokenlessImage.token, undefined);
  assert.equal(references[1], file);
});

test("an image that already carries its token is neither duplicated nor replaced", () => {
  const { text, references } = attachImageTokens(`x${image.token}`, [image], () => "\ue103");
  assert.equal(text, `x${image.token}`);
  assert.equal(references[0], image);
});

test("attaching restored drafts is idempotent", () => {
  const first = attachImageTokens("", [tokenlessImage], () => "\ue104");
  const second = attachImageTokens(first.text, first.references, () => "\ue105");
  assert.equal(second.text, first.text);
  assert.equal(second.references[0].token, "\ue104");
});

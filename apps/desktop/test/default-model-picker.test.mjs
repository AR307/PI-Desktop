import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("model settings expose image selection but no fixed chat default", async () => {
  const page = await read("../src/components/settings/ModelConfigPage.tsx");
  const list = await read("../src/components/settings/ServiceList.tsx");
  assert.doesNotMatch(page, /"settings\.defaultModel"|changeDefaultModel|setDefaultModel|pickingDefault/);
  assert.doesNotMatch(list, /settings\.makeDefault|onMakeDefault|defaultProviderId/);
  assert.match(page, /<ImageGenerationModelRow/);
});

test("shared anchored menus keep keyboard focus contained", async () => {
  const menuSource = await read("../src/components/settings/AnchoredMenu.tsx");

  // Opening focuses the current option, so Enter re-confirms the default
  // instead of committing whichever service happens to be listed first.
  assert.match(menuSource, /aria-selected="true"\]:not\(\[disabled\]\)/);
  // Closing hands focus back to the trigger rather than dropping it on <body>.
  assert.match(menuSource, /anchorRef\?\.current \?\? triggerRef\.current/);
  assert.match(menuSource, /\?\.focus\(\)/);
});

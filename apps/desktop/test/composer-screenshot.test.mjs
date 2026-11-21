import assert from "node:assert/strict";
import test from "node:test";
import { screenshotPixelRect } from "../electron/screenshot-contract.ts";
import { composerToolbar } from "./helpers/composer-toolbar.mjs";
import { slotSsr } from "./helpers/slot-ssr.mjs";

test("a selected area crops the captured monitor at its real pixel density", () => {
  assert.deepEqual(screenshotPixelRect({ left: 0.25, top: 0.2, right: 0.75, bottom: 0.8 }, { width: 3840, height: 2160 }), { x: 960, y: 432, width: 1920, height: 1296 });
  assert.deepEqual(screenshotPixelRect({ left: 0, top: 0, right: 1, bottom: 1 }, { width: 1920, height: 1080 }), { x: 0, y: 0, width: 1920, height: 1080 });
});

test("malformed or out-of-screen selections cannot become image crops", () => {
  for (const region of [null, {}, { left: -1, top: 0, right: 1, bottom: 1 }, { left: 0, top: 0, right: 2, bottom: 1 }, { left: 1, top: 0, right: 0, bottom: 1 }, { left: 0, top: NaN, right: 1, bottom: 1 }]) {
    assert.throws(() => screenshotPixelRect(region, { width: 1920, height: 1080 }), /Invalid screenshot region/);
  }
  assert.equal(screenshotPixelRect({ left: 0, top: 0, right: 0.0001, bottom: 0.0001 }, { width: 1920, height: 1080 }), null);
});

test("the camera follows the composer's attachment and busy restrictions", async (t) => {
  const ssr = await slotSsr(t);
  const render = await composerToolbar(t, ssr);
  const camera = html => html.match(/<button\b[^>]*aria-label="chat\.screenshot"[^>]*>/)?.[0];
  assert.ok(camera(render()), "the idle composer exposes its camera action");
  assert.doesNotMatch(camera(render()), /\bdisabled/);
  for (const props of [{ controlsBlocked: true }, { pasting: true }, { attachmentsAllowed: false }]) {
    const disabled = await composerToolbar(t, ssr, props);
    assert.match(camera(disabled()), /\bdisabled/, JSON.stringify(props));
  }
});

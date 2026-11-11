import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as workPanelResize from "../src/lib/work-panel-resize.ts";
import * as workPanelTabs from "../src/lib/work-panel-tabs.ts";

const { outputText } = ts.transpileModule(readFileSync(new URL("../src/stores/slices/work-panel-slice.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const closedBrowserTabs = [];
const imports = {
  "../../features/chat/side-chat-service": {
    confirmSideChatDiscard: async () => { throw new Error("Browser recovery must not close a side chat"); },
    closeSideChat: async () => { throw new Error("Browser recovery must not close a side chat"); },
  },
  "../../lib/api": {
    api: {
      pluginViewClose: async (_pluginId, _viewId, options) => {
        closedBrowserTabs.push(options);
      },
    },
  },
  "../../lib/remote-session-safety": { isRemoteSession: () => false },
  "../../lib/work-panel-tabs": workPanelTabs,
  "../../lib/work-panel-resize": workPanelResize,
};
const module = { exports: {} };
new Function("require", "exports", "module", outputText)((id) => {
  assert.ok(Object.hasOwn(imports, id), `Unexpected import: ${id}`);
  return imports[id];
}, module.exports, module);

function store() {
  let state = {
    activeSessionId: "A", sessions: [], workPanelOpen: false,
    workPanelTabs: [], activeWorkPanelTabId: null, workPanelFileRequest: null,
    workPanelContexts: {},
  };
  const get = () => state;
  const set = (value) => { state = { ...state, ...(typeof value === "function" ? value(state) : value) }; };
  Object.assign(state, module.exports.createWorkPanelSlice({ get, set, isSessionSelectionPending: () => false }));
  return { get, set };
}
const page = (sessionId, tabId, title) => ({ sessionId, tabId, title, url: `https://fixture.invalid/${title}`, isLoading: false, canGoBack: false, canGoForward: false });

test("renderer recovery restores owned Browser tabs without opening a collapsed panel", () => {
  const { get } = store();
  get().restoreBrowserWorkPanelTabs("A", [page("A", "a", "A"), page("B", "b", "B")]);
  assert.deepEqual(get().workPanelTabs.map((tab) => tab.id), ["a"]);
  assert.equal(get().activeWorkPanelTabId, "a");
  assert.equal(get().workPanelOpen, false);
  get().openWorkPanel();
  assert.equal(get().workPanelOpen, true);
  get().collapseWorkPanel();
  assert.equal(get().workPanelContexts.A.tabs[0].id, "a");
});

test("background restore and navigation events only update the owning context", () => {
  const { get } = store();
  get().restoreBrowserWorkPanelTabs("B", [page("B", "b", "B")]);
  assert.deepEqual(get().workPanelTabs, []);
  assert.equal(get().workPanelOpen, false);
  get().updateBrowserWorkPanelTab(page("B", "b", "Updated B"));
  assert.equal(get().workPanelContexts.B.tabs[0].label, "Updated B");
  assert.deepEqual(get().workPanelTabs, []);
});

test("renderer recovery does not duplicate tabs or replace a user-selected resource", () => {
  const { get } = store();
  get().openWorkPanelTab(workPanelTabs.toolWorkPanelTab("review"));
  get().restoreBrowserWorkPanelTabs("A", [page("A", "a", "A")]);
  get().restoreBrowserWorkPanelTabs("A", [page("A", "a", "Old A")]);
  assert.deepEqual(get().workPanelTabs.map((tab) => tab.id), ["review", "a"]);
  assert.equal(get().activeWorkPanelTabId, "review");
  assert.equal(get().workPanelTabs[1].label, "A");
  get().closeWorkPanelTab("a");
  assert.deepEqual(get().workPanelTabs.map((tab) => tab.id), ["review"]);
});

test("bulk tab closing retains the target and releases Browser resources", () => {
  closedBrowserTabs.length = 0;
  const { get, set } = store();
  const browserA = workPanelTabs.browserPluginTab("https://a.example");
  const browserB = workPanelTabs.browserPluginTab("https://b.example");
  const review = workPanelTabs.toolWorkPanelTab("review");
  const file = workPanelTabs.fileWorkPanelTab("src/App.tsx");
  set({
    workPanelOpen: true,
    workPanelTabs: [browserA, review, browserB, file],
    activeWorkPanelTabId: file.id,
  });

  get().closeOtherWorkPanelTabs(review.id);

  assert.deepEqual(get().workPanelTabs, [review]);
  assert.equal(get().activeWorkPanelTabId, review.id);
  assert.equal(get().workPanelContexts.A.open, true);
  assert.deepEqual(get().workPanelContexts.A.tabs, [review]);
  assert.deepEqual(closedBrowserTabs, [
    { sessionId: "A", tabId: browserA.id },
    { sessionId: "A", tabId: browserB.id },
  ]);

  const remainingBrowser = workPanelTabs.browserPluginTab("https://remaining.example");
  set({
    workPanelTabs: [review, remainingBrowser],
    activeWorkPanelTabId: remainingBrowser.id,
  });
  get().closeAllWorkPanelTabs();

  assert.deepEqual(get().workPanelTabs, []);
  assert.equal(get().activeWorkPanelTabId, null);
  assert.equal(get().workPanelOpen, true);
  assert.equal(get().workPanelFileRequest, null);
  assert.deepEqual(get().workPanelContexts.A.tabs, []);
  assert.deepEqual(closedBrowserTabs[2], {
    sessionId: "A",
    tabId: remainingBrowser.id,
  });
});

for (const action of ["closeAllWorkPanelTabs", "closeOtherWorkPanelTabs"]) {
  test(`${action} respects side-chat cancellation and closes confirmed children`, async () => {
    const events = [];
    let confirmed = false;
    const service = imports["../../features/chat/side-chat-service"];
    const original = { ...service };
    service.confirmSideChatDiscard = async (id) => { events.push(["confirm", id]); return confirmed; };
    service.closeSideChat = async (id) => { events.push(["close", id]); };
    try {
      closedBrowserTabs.length = 0;
      const { get, set } = store();
      const review = workPanelTabs.toolWorkPanelTab("review");
      const browser = workPanelTabs.browserPluginTab("https://fixture.invalid");
      const child = { id: "side-child", kind: "side-chat", resource: "side-child", label: "Child" };
      set({ workPanelOpen: true, workPanelTabs: [review, child, browser], activeWorkPanelTabId: child.id });
      await get()[action](review.id);
      assert.deepEqual(get().workPanelTabs, action === "closeAllWorkPanelTabs" ? [child] : [review, child]);
      assert.deepEqual(events, [["confirm", "side-child"]]);
      assert.deepEqual(closedBrowserTabs, [{ sessionId: "A", tabId: browser.id }]);
      confirmed = true;
      await get()[action](review.id);
      assert.deepEqual(get().workPanelTabs, action === "closeAllWorkPanelTabs" ? [] : [review]);
      assert.deepEqual(events.slice(-2), [["confirm", "side-child"], ["close", "side-child"]]);
    } finally {
      Object.assign(service, original);
    }
  });
}

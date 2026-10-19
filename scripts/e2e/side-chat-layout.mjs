import assert from "node:assert/strict";

/** Measure the actual rendered panes, including the transcript's composer mask. */
export async function assertSideChatLayout(evaluate, label) {
  const layout = await evaluate(`(() => {
    const side = document.querySelector('.side-chat-pane');
    const main = document.querySelector('.main-pane');
    const measure = root => {
      const dock = root.querySelector('.composer-dock');
      const scroll = root.querySelector('.thread-scroll');
      const toolbar = root.querySelector('.composer-toolbar');
      const left = toolbar.querySelector('.composer-left').getBoundingClientRect();
      const right = toolbar.querySelector('.composer-right').getBoundingClientRect();
      const d = dock.getBoundingClientRect(), s = scroll.getBoundingClientRect();
      const shell = root.querySelector('.composer-shell');
      const style = getComputedStyle(shell);
      return { dockHeight: d.height, overlap: s.bottom - d.top,
        dockPadding: getComputedStyle(dock).padding,
        rowDelta: Math.abs(left.y + left.height / 2 - right.y - right.height / 2),
        radius: style.borderRadius, background: style.backgroundColor,
        overflow: toolbar.scrollWidth - toolbar.clientWidth };
    };
    return {main: measure(main), side: measure(side)};
  })()`);
  assert.ok(Math.abs(layout.side.overlap - layout.side.dockHeight) <= 2,
    `${label}: transcript mask must reserve the overlay dock once, not a second in-flow dock: ${JSON.stringify(layout)}`);
  assert.ok(layout.side.rowDelta <= 2, `${label}: side controls must share the main toolbar row: ${JSON.stringify(layout)}`);
  assert.ok(layout.side.overflow <= 2, `${label}: toolbar controls must stay inside the composer: ${JSON.stringify(layout)}`);
  for (const metric of ['dockPadding', 'radius', 'background'])
    assert.equal(layout.side[metric], layout.main[metric], `${label}: shared composer ${metric}`);
}

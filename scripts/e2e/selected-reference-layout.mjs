import assert from "node:assert/strict";

export async function assertSelectionActions(evaluate) {
  const menu = await evaluate(`(() => {
    const menu = document.querySelector('.selection-actions');
    const style = getComputedStyle(menu), bounds = menu.getBoundingClientRect();
    return { border: style.borderWidth, radius: style.borderRadius,
      shadow: style.boxShadow, padding: style.padding,
      inside: bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight,
      controls: [...menu.querySelectorAll('button')].map(button => ({
        height: button.getBoundingClientRect().height,
        label: button.textContent.trim(),
        border: getComputedStyle(button).borderWidth,
      })) };
  })()`);
  assert.equal(menu.border, "0px", "selection actions have no enclosing border");
  assert.equal(menu.radius, "0px", "selection actions have no enclosing rounded box");
  assert.equal(menu.shadow, "none", "selection actions have no enclosing shadow");
  assert.equal(menu.padding, "0px", "selection actions do not add outer padding");
  assert.ok(menu.inside, "selection actions stay within the viewport");
  assert.equal(menu.controls.length, 2);
  for (const control of menu.controls) {
    assert.ok(control.height >= 24 && control.height <= 28,
      `selection action stays compact and clickable: ${JSON.stringify(control)}`);
    assert.equal(control.border, "0px");
    assert.ok(control.label);
  }
}

export async function assertMessageQuotes(evaluate, selector) {
  const quotes = await evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    const style = getComputedStyle(root);
    return { border: style.borderWidth, radius: style.borderRadius,
      summaryHeight: root.querySelector('summary').getBoundingClientRect().height,
      overflow: root.scrollWidth - root.clientWidth,
      text: root.innerText,
      sources: [...root.querySelectorAll('.message-quote-source')].map(source => ({
        focusable: source.tabIndex === 0, text: source.textContent.trim(),
      })),
      removes: [...root.querySelectorAll('.message-quote-remove')].map(button => ({
        text: button.textContent.trim(), name: button.getAttribute('aria-label'),
        width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height,
        icon: !!button.querySelector('svg'),
      })),
      count: root.querySelectorAll('.message-quote').length,
    };
  })()`);
  assert.equal(quotes.border, "0px", "annotations have no enclosing box");
  assert.equal(quotes.radius, "0px");
  assert.ok(quotes.summaryHeight >= 24 && quotes.summaryHeight <= 28);
  assert.ok(quotes.overflow <= 1, "annotation content fits its pane");
  assert.doesNotMatch(quotes.text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i,
    "full source IDs stay out of the visible reference rows");
  assert.equal(quotes.sources.length, quotes.count);
  for (const source of quotes.sources) assert.ok(source.focusable && source.text);
  for (const remove of quotes.removes) {
    assert.ok(remove.icon && remove.name, "icon removal retains an accessible name");
    assert.equal(remove.text, "");
    assert.ok(remove.width >= 24 && remove.width <= 28);
    assert.ok(remove.height >= 24 && remove.height <= 28);
  }
}

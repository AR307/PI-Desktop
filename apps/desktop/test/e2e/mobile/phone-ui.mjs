// Navigation helpers for the redesigned phone UI: Sessions / Activity / Me tabs
// and conversations pushed from any list.

/** Open a shared conversation from the Sessions tab. */
export async function openSharedSession(phone, title) {
  if (await phone.locator(".conversation").count()) await closeConversation(phone);
  await phone.locator(".tab-bar").getByRole("button", { name: /^(Sessions|会话)$/ }).click();
  await phone.locator(".session-card").filter({ hasText: title }).first().click();
  await phone.locator(".conversation .composer textarea").waitFor();
}

/** Leave the open conversation back to the tabs. */
export async function closeConversation(phone) {
  await phone.locator(".conversation-header").getByRole("button", { name: /^(Back|返回)$/ }).click();
  await phone.locator(".conversation").waitFor({ state: "detached" });
}

/**
 * Fix language and theme before sign-in. Appearance lives in the Me tab once
 * signed in; before that the stored per-device preference is what applies.
 */
export async function presetAppearance(phone, { language, theme }) {
  await phone.evaluate(({ language, theme }) => { localStorage.setItem("pi.mobile.language", language); localStorage.setItem("pi.mobile.theme", theme); }, { language, theme });
  await phone.reload();
}

/** Change theme and language from the Me tab, then return to Sessions. */
export async function changeAppearance(phone, { theme, language }) {
  await openTab(phone, /^(Me|我的)$/);
  if (theme) await phone.getByRole("group", { name: /^(Theme|主题)$/ }).getByRole("button", { name: theme, exact: true }).click();
  if (language) await phone.getByLabel(/^(Language|语言)$/).selectOption(language);
  await openTab(phone, /^(Sessions|会话)$/);
}

/** Switch tabs by their visible name (string) or a pattern covering both languages. */
export async function openTab(phone, name) {
  const tab = phone.locator(".tab-bar").getByRole("button", typeof name === "string" ? { name, exact: true } : { name });
  await tab.click();
  // The switch commits inside a View Transition: wait until the tab is current and the transition has ended.
  await tab.and(phone.locator('[aria-current="page"]')).waitFor();
  await phone.waitForFunction(() => !document.documentElement.dataset.nav);
}

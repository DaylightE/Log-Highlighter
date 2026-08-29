const fhlApi = globalThis.browser || globalThis.chrome;

fhlApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "fhl-auth-tab") return;
  if (message.action === "open") {
    const sourceTabId = Number.isInteger(sender.tab?.id) ? sender.tab.id : null;
    fhlApi.tabs.create({ url: message.url, active: true })
      .then(tab => sendResponse({ tabId: tab.id, sourceTabId }))
      .catch(error => sendResponse({ error: error?.message || "Unable to open the F-List sign-in tab." }));
    return true;
  }
  if (message.action === "close") {
    const refocus = Number.isInteger(message.returnTabId)
      ? fhlApi.tabs.update(message.returnTabId, { active: true }).then(() => true).catch(() => false)
      : Promise.resolve(false);
    refocus.then(refocused => fhlApi.tabs.remove(message.tabId)
      .then(() => sendResponse({ closed: true, refocused }))
      .catch(() => sendResponse({ closed: false })));
    return true;
  }
});

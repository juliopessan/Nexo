importScripts("store.js", "ai.js", "enrich.js", "sync.js");

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.alarms.create("nexo-followups", { periodInMinutes: 60 });
  chrome.alarms.create("nexo-sync", { periodInMinutes: 1 });
});

// Toda chamada externa passa por aqui; content script e painel só trocam mensagens.
const handlers = {
  "open-panel": (_, sender) => sender.tab && chrome.sidePanel.open({ tabId: sender.tab.id }),
  "ai-suggest": ({ kind, context }) => NexoAI.suggest(kind, context),
  "enrich": ({ id }) => NexoEnrich.enrich(id),
  "sync-now": () => NexoSync.syncNow(),
  "login": ({ email, password }) => NexoSync.login(email, password).then(() => NexoSync.syncNow()),
  "logout": () => NexoSync.logout(),
  "create-team": ({ name }) => NexoSync.createTeam(name).then((t) => NexoSync.syncNow().then(() => t)),
  "join-team": ({ code }) => NexoSync.joinTeam(code).then((t) => NexoSync.syncNow().then(() => t))
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = handlers[msg.type];
  if (!h) return;
  Promise.resolve(h(msg, sender)).then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: e.message }));
  return true;
});

// Push rápido após edições locais (o alarme de 1 min cobre o service worker adormecido)
let syncTimer;
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.contacts && !changes.templates) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => NexoSync.syncNow().catch(recordSyncError), 3000);
});
const recordSyncError = (e) => NexoStore.saveSettings({ lastSyncError: e.message });

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "nexo-sync") return NexoSync.syncNow().catch(recordSyncError);
  if (a.name !== "nexo-followups") return;
  const { contacts } = await NexoStore.get();
  const { notified = {} } = await chrome.storage.local.get("notified");
  const today = new Date().toISOString().slice(0, 10);
  const due = Object.values(contacts).filter((c) => c.followUp && c.followUp <= today && notified[c.id] !== c.followUp);
  if (!due.length) return;
  chrome.notifications.create({
    type: "basic", iconUrl: "icons/128.png", title: "Nexo — follow-ups de hoje",
    message: due.slice(0, 4).map((c) => "• " + c.name).join("\n") + (due.length > 4 ? `\n+${due.length - 4}` : "")
  });
  due.forEach((c) => (notified[c.id] = c.followUp));
  chrome.storage.local.set({ notified });
});

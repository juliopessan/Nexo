importScripts("store.js", "ai.js", "enrich.js", "sync.js", "persist.js");

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // Instalação nova (não atualização): o painel oferece restaurar o backup
  if (reason === "install") await NexoStore.saveSettings({ freshInstall: true });
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.alarms.create("nexo-followups", { periodInMinutes: 60 });
  chrome.alarms.create("nexo-sync", { periodInMinutes: 1 });
});

// Depois de entrar: restaura o cofre pessoal (chaves, tom, metas…) e sincroniza a equipe
async function afterLogin() {
  const restored = await NexoPersist.pullVault().catch(() => false);
  await NexoSync.syncNow();
  return { restored };
}

// Toda chamada externa passa por aqui; content script e painel só trocam mensagens.
const handlers = {
  "open-panel": (_, sender) => sender.tab && chrome.sidePanel.open({ tabId: sender.tab.id }),
  "ai-suggest": ({ kind, context }) => NexoAI.suggest(kind, context),
  "enrich": ({ id }) => NexoEnrich.enrich(id),
  "sync-now": () => NexoSync.syncNow(),
  "login": ({ email, password }) => NexoSync.login(email, password).then(afterLogin),
  "login-google": ({ inviteCode }) => NexoSync.loginGoogle(inviteCode).then(afterLogin),
  "backup-now": () => NexoPersist.writeBackupFile(),
  "register": ({ email, password, inviteCode, signupCode }) => NexoSync.register(email, password, inviteCode, signupCode).then(afterLogin),
  "list-teams": () => NexoSync.listTeams(),
  "switch-team": ({ id }) => NexoSync.switchTeam(id).then((t) => NexoSync.syncNow().then(() => t)),
  "team-info": () => NexoSync.teamInfo(),
  "rotate-invite": () => NexoSync.rotateInvite(),
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

chrome.storage.onChanged.addListener((ch) => NexoPersist.onStorageChanged(ch));
chrome.alarms.create("nexo-backup", { periodInMinutes: 24 * 60 });

// Badge no ícone: quantos itens prioritários (seus posts + DMs) esperam resposta
async function updateBadge() {
  const { queue = {} } = await chrome.storage.local.get("queue");
  const n = Object.values(queue).filter((q) => q.status === "open" && q.priority === 1).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#F97316" });
  await chrome.action.setBadgeText({ text: n ? String(Math.min(n, 99)) : "" });
}
chrome.storage.onChanged.addListener((ch) => { if (ch.queue) updateBadge(); });
updateBadge();

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
  if (a.name === "nexo-backup") return NexoPersist.writeBackupFile().catch(() => {});
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

// Camada única de dados (chrome.storage.local). Compartilhada por content script e side panel.
const NexoStore = (() => {
  const STAGES = ["Novo", "Contatado", "Conversando", "Reunião", "Cliente", "Perdido"];
  const DEFAULT_TEMPLATES = [
    { id: "t1", kind: "dm", name: "Primeiro contato", body: "Oi {firstName}, tudo bem? Vi seu trabalho como {headline} e achei muito interessante. Bora trocar uma ideia?" },
    { id: "t2", kind: "dm", name: "Follow-up", body: "Oi {firstName}! Passando para retomar nossa conversa — faz sentido marcarmos 15 min esta semana?" },
    { id: "t3", kind: "comment", name: "Comentário de valor", body: "Excelente ponto, {firstName}! Na minha experiência, " }
  ];
  const get = async () => {
    const d = await chrome.storage.local.get(["contacts", "templates"]);
    const contacts = Object.fromEntries(Object.entries(d.contacts || {}).filter(([, c]) => !c.deleted));
    return { contacts, templates: (d.templates || DEFAULT_TEMPLATES).filter((t) => !t.deleted) };
  };
  const idFromUrl = (url) => {
    const m = /linkedin\.com\/in\/([^/?#]+)/.exec(url || "");
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  };
  // Escritas leem o mapa bruto (com tombstones) para não apagar exclusões ainda não sincronizadas.
  const rawContacts = async () => (await chrome.storage.local.get("contacts")).contacts || {};
  async function upsertContact(c) {
    const contacts = await rawContacts();
    const prev = (!contacts[c.id]?.deleted && contacts[c.id]) || { stage: "Novo", tags: [], notes: "", followUp: null, activities: [], createdAt: Date.now() };
    contacts[c.id] = { ...prev, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== "")), updatedAt: Date.now() };
    await chrome.storage.local.set({ contacts });
    return contacts[c.id];
  }
  async function patchContact(id, patch) {
    const contacts = await rawContacts();
    if (!contacts[id] || contacts[id].deleted) return null;
    contacts[id] = { ...contacts[id], ...patch, updatedAt: Date.now() };
    await chrome.storage.local.set({ contacts });
    return contacts[id];
  }
  async function logActivity(id, type, text) {
    const contacts = await rawContacts();
    if (!contacts[id] || contacts[id].deleted) return;
    contacts[id].activities = [{ type, text, at: Date.now() }, ...(contacts[id].activities || [])].slice(0, 200);
    contacts[id].lastTouch = contacts[id].updatedAt = Date.now();
    await chrome.storage.local.set({ contacts });
  }
  async function deleteContact(id) {
    // Tombstone em vez de delete: a sincronização precisa propagar exclusões para a equipe.
    const { contacts = {} } = await chrome.storage.local.get("contacts");
    if (contacts[id]) contacts[id] = { id, deleted: true, updatedAt: Date.now() };
    await chrome.storage.local.set({ contacts });
  }
  async function saveTemplates(next) {
    const { templates: raw } = await chrome.storage.local.get("templates");
    const keep = new Set(next.map((t) => t.id));
    const tombstones = (raw || DEFAULT_TEMPLATES).filter((t) => !keep.has(t.id)).map((t) => ({ id: t.id, deleted: true, updatedAt: Date.now() }));
    const stamped = next.map((t) => ({ ...t, updatedAt: t.updatedAt || Date.now() }));
    await chrome.storage.local.set({ templates: [...stamped, ...tombstones] });
  }
  const getSettings = async () => (await chrome.storage.local.get("settings")).settings || {};
  const saveSettings = async (patch) => chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
  // ---- Engajamento: fila (pessoal, não sincroniza), estatísticas do dia e "quem sou eu" ----
  const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD no fuso local
  const DEFAULT_GOALS = { like: 10, comment: 5, reply: 10, dm: 5 };

  async function getQueue() {
    const { queue = {} } = await chrome.storage.local.get("queue");
    return queue;
  }
  // Adiciona itens novos sem reabrir os que o usuário já resolveu ou ignorou
  async function enqueue(items) {
    const queue = await getQueue();
    let added = 0, changed = false;
    for (const it of items) {
      const cur = queue[it.id];
      if (cur) {
        const priority = Math.min(cur.priority || 2, it.priority || 2);
        if (cur.status === "open" && (cur.text !== it.text || priority !== cur.priority)) {
          queue[it.id] = { ...cur, ...it, postText: it.postText || cur.postText, priority, status: "open" };
          changed = true;
        }
        continue;
      }
      queue[it.id] = { priority: 2, ...it, status: "open", seenAt: Date.now() };
      added++; changed = true;
    }
    if (!changed) return 0; // a página é varrida a cada mudança de DOM: não regrava à toa
    // Mantém a fila enxuta: descarta itens resolvidos com mais de 14 dias
    for (const [id, it] of Object.entries(queue)) if (it.status !== "open" && Date.now() - (it.doneAt || it.seenAt) > 14 * 864e5) delete queue[id];
    await chrome.storage.local.set({ queue });
    return added;
  }
  async function setQueueStatus(id, status) {
    const queue = await getQueue();
    if (!queue[id] || queue[id].status === status) return;
    queue[id] = { ...queue[id], status, doneAt: Date.now() };
    await chrome.storage.local.set({ queue });
  }
  async function bumpStat(kind) {
    const { stats = {} } = await chrome.storage.local.get("stats");
    const d = today();
    stats[d] = { like: 0, comment: 0, reply: 0, dm: 0, ...stats[d] };
    stats[d][kind] = (stats[d][kind] || 0) + 1;
    for (const k of Object.keys(stats)) if (Date.now() - new Date(k).getTime() > 90 * 864e5) delete stats[k];
    await chrome.storage.local.set({ stats });
  }
  async function getStats() {
    const { stats = {} } = await chrome.storage.local.get("stats");
    return { today: { like: 0, comment: 0, reply: 0, dm: 0, ...stats[today()] }, all: stats };
  }
  // Pedido de inserção para a próxima página aberta (fila → abrir item → rascunho já no campo)
  const setPending = (p) => chrome.storage.local.set({ pendingInsert: { ...p, at: Date.now() } });
  async function takePending() {
    const { pendingInsert } = await chrome.storage.local.get("pendingInsert");
    if (!pendingInsert || Date.now() - pendingInsert.at > 5 * 60_000) return null;
    return pendingInsert;
  }
  const clearPending = () => chrome.storage.local.remove("pendingInsert");

  const fill = (body, c = {}) => body
    .replace(/\{firstName\}/g, (c.name || "").split(" ")[0] || "")
    .replace(/\{name\}/g, c.name || "")
    .replace(/\{headline\}/g, c.headline || "")
    .replace(/\{company\}/g, c.company || "");
  return { STAGES, get, idFromUrl, upsertContact, patchContact, logActivity, deleteContact, saveTemplates, getSettings, saveSettings, fill,
    DEFAULT_GOALS, getQueue, enqueue, setQueueStatus, bumpStat, getStats, setPending, takePending, clearPending };
})();

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
  const fill = (body, c = {}) => body
    .replace(/\{firstName\}/g, (c.name || "").split(" ")[0] || "")
    .replace(/\{name\}/g, c.name || "")
    .replace(/\{headline\}/g, c.headline || "")
    .replace(/\{company\}/g, c.company || "");
  return { STAGES, get, idFromUrl, upsertContact, patchContact, logActivity, deleteContact, saveTemplates, getSettings, saveSettings, fill };
})();

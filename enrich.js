// Enriquecimento: dados que o LinkedIn já mostra ao usuário + Hunter.io (opcional, chave do usuário).
// Cada campo guarda a fonte, para distinguir o que foi observado do que foi inferido por terceiros.
const NexoEnrich = (() => {
  async function hunter(path, params, key) {
    const qs = new URLSearchParams({ ...params, api_key: key });
    const res = await fetch(`https://api.hunter.io/v2/${path}?${qs}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.errors?.[0]?.details || `Hunter HTTP ${res.status}`);
    return body.data || {};
  }

  async function enrich(id) {
    const { contacts } = await NexoStore.get();
    const c = contacts[id];
    if (!c) throw new Error("Contato não encontrado.");
    const { hunterKey } = await NexoStore.getSettings();
    if (!hunterKey) throw new Error("Configure a chave do Hunter.io na aba Config.");
    const [first, ...rest] = (c.name || "").split(" ");
    const patch = {};
    const companyQuery = c.companyInfo?.domain ? { domain: c.companyInfo.domain } : c.company ? { company: c.company } : null;
    if (!companyQuery) throw new Error("Informe a empresa do contato antes de enriquecer.");

    if (!c.email || c.emailSource !== "linkedin") {
      const f = await hunter("email-finder", { ...companyQuery, first_name: first, last_name: rest.join(" ") }, hunterKey);
      if (f.email) Object.assign(patch, { email: f.email, emailSource: "hunter", emailScore: f.score ?? null });
      if (f.domain) patch.companyInfo = { ...(c.companyInfo || {}), domain: f.domain };
    }
    const domain = patch.companyInfo?.domain || c.companyInfo?.domain;
    if (domain) {
      try {
        const co = await hunter("companies/find", { domain }, hunterKey);
        patch.companyInfo = {
          ...(patch.companyInfo || c.companyInfo || {}), domain, source: "hunter",
          name: co.name ?? null,
          industry: co.category?.industry ?? null,
          employees: co.metrics?.employees ?? null,
          location: [co.geo?.city, co.geo?.country].filter(Boolean).join(", ") || null,
          description: co.description ?? null
        };
      } catch (e) {
        patch.companyInfo = { ...(patch.companyInfo || {}), domain, enrichError: e.message };
      }
    }
    if (!Object.keys(patch).length) return { contact: c, found: false };
    const updated = await NexoStore.patchContact(id, patch);
    await NexoStore.logActivity(id, "enrich", patch.email ? `E-mail encontrado (${patch.emailSource})` : "Dados da empresa atualizados");
    return { contact: updated, found: true };
  }

  return { enrich };
})();

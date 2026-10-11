// Enriquecimento via Exa (busca na web com saída estruturada). Roda só no service worker, com a chave do usuário.
// Cada campo guarda as fontes e a confiança que a própria Exa devolve em output.grounding.
const NexoEnrich = (() => {
  // Máx. 10 propriedades no outputSchema (limite da Exa)
  const SCHEMA = {
    type: "object",
    properties: {
      email: { type: "string", description: "E-mail profissional publicado publicamente para ESTA pessoa; vazio se não houver" },
      company_name: { type: "string" },
      company_domain: { type: "string", description: "Domínio do site oficial da empresa atual, ex.: acme.com" },
      industry: { type: "string" },
      employees: { type: "string", description: "Faixa de funcionários, ex.: 51-200" },
      company_location: { type: "string" },
      company_description: { type: "string", description: "Uma frase sobre o que a empresa faz" },
      person_summary: { type: "string", description: "Duas frases sobre a atuação profissional da pessoa" },
      interests: { type: "array", items: { type: "string" }, description: "Até 5 temas sobre os quais a pessoa fala ou publica" }
    },
    required: ["company_name", "person_summary"]
  };

  const SYSTEM = "Responda apenas com fatos presentes nas fontes encontradas. Deixe vazio o que não souber. " +
    "Nunca deduza e-mails por padrão (nome.sobrenome@dominio): só informe um e-mail se ele aparecer publicado para esta pessoa. " +
    "Confirme que as fontes são sobre a mesma pessoa (nome, cargo e empresa coerentes com o perfil do LinkedIn informado).";

  const clean = (v) => (typeof v === "string" ? v.trim() || null : v ?? null);
  const domainOf = (v) => clean(v)?.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase() || null;

  async function enrich(id) {
    const { contacts } = await NexoStore.get();
    const c = contacts[id];
    if (!c) throw new Error("Contato não encontrado.");
    const { exaKey } = await NexoStore.getSettings();
    if (!exaKey) throw new Error("Configure a chave da Exa na aba Config.");

    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": exaKey },
      body: JSON.stringify({
        query: `${c.name}${c.headline ? `, ${c.headline}` : ""}${c.company ? `, ${c.company}` : ""}. LinkedIn: ${c.url}`,
        type: "deep-lite",
        category: "people",
        numResults: 5,
        systemPrompt: SYSTEM,
        outputSchema: SCHEMA
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || body?.message || `Exa HTTP ${res.status}`);
    const out = body.output?.content;
    if (!out || typeof out !== "object") return { contact: c, found: false };

    // Fontes e confiança por campo (ex.: "email" → [{url,title}], "high")
    const grounding = Object.fromEntries((body.output.grounding || []).map((g) => [g.field, { confidence: g.confidence, sources: (g.citations || []).map((x) => x.url).slice(0, 3) }]));
    const patch = {};
    const email = clean(out.email);
    // E-mail capturado do próprio LinkedIn tem prioridade sobre o que a web sugerir
    if (email && /@/.test(email) && c.emailSource !== "linkedin") {
      Object.assign(patch, { email, emailSource: "exa", emailConfidence: grounding.email?.confidence || null, emailSources: grounding.email?.sources || [] });
    }
    patch.companyInfo = {
      ...(c.companyInfo || {}),
      source: "exa",
      name: clean(out.company_name),
      domain: domainOf(out.company_domain),
      industry: clean(out.industry),
      employees: clean(out.employees),
      location: clean(out.company_location),
      description: clean(out.company_description),
      sources: [...new Set(Object.values(grounding).flatMap((g) => g.sources))].slice(0, 5),
      enrichedAt: Date.now()
    };
    if (clean(out.person_summary)) patch.about = clean(out.person_summary);
    if (Array.isArray(out.interests)) patch.interests = out.interests.map(clean).filter(Boolean).slice(0, 5);

    const updated = await NexoStore.patchContact(id, patch);
    await NexoStore.logActivity(id, "enrich", patch.email ? "E-mail público encontrado (Exa)" : "Perfil e empresa enriquecidos (Exa)");
    return { contact: updated, found: true, costDollars: body.costDollars?.total ?? null };
  }

  return { enrich };
})();

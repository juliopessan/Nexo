// Sincronização com o servidor próprio do Nexo (server/). Last-write-wins por registro usando updatedAt;
// o cursor de pull é a sequência do servidor, que reflete a ordem de commit de cada equipe.
const NexoSync = (() => {
  const S = () => NexoStore.getSettings();

  async function call(path, { body, auth = true } = {}) {
    const s = await S();
    if (!s.serverUrl) throw new Error("Configure o endereço do servidor na aba Config.");
    if (auth && !s.session?.token) throw new Error("Faça login na aba Config.");
    const res = await fetch(`${s.serverUrl.replace(/\/$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(auth && { authorization: `Bearer ${s.session.token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && auth) await NexoStore.saveSettings({ session: null });
    if (!res.ok) throw new Error(data.error || `Servidor respondeu HTTP ${res.status}`);
    return data;
  }

  const resetTeamState = { syncCursor: null, lastPushed: {} };
  const useTeam = (t) => NexoStore.saveSettings({ teamId: t.id, teamName: t.name, inviteCode: t.invite_code, teamRole: t.role, ...resetTeamState });

  async function startSession(d) {
    // A senha só trafega nesta chamada; guardamos apenas o token da sessão.
    await NexoStore.saveSettings({ session: { token: d.token, email: d.user.email, user_id: d.user.id } });
    if (d.team) return useTeam(d.team);
    const { teams } = await call("/me");
    const { teamId } = await S();
    const keep = teams.find((t) => t.id === teamId) || (teams.length === 1 && teams[0]);
    if (keep) await useTeam(keep);
  }

  // Entrar com Google: o Chrome abre a tela de contas do Google e devolve um ID token, que o SERVIDOR verifica
  async function loginGoogle(inviteCode) {
    const { google } = await call("/auth/config", { auth: false });
    if (!google?.clientId) throw new Error("O servidor ainda não tem o login com Google configurado (GOOGLE_CLIENT_ID).");
    const nonce = crypto.randomUUID();
    const redirect = chrome.identity.getRedirectURL();
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: google.clientId, response_type: "id_token", redirect_uri: redirect,
      scope: "openid email profile", nonce, prompt: "select_account"
    });
    let back;
    try { back = await chrome.identity.launchWebAuthFlow({ url, interactive: true }); }
    catch (e) { throw new Error(/did not approve|canceled|cancelled/i.test(e.message) ? "Login com Google cancelado." : `Google: ${e.message}. Confira se ${redirect} está nos URIs de redirecionamento do cliente OAuth.`); }
    const params = new URLSearchParams(new URL(back).hash.slice(1));
    if (params.get("error")) throw new Error(`Google: ${params.get("error")}`);
    const idToken = params.get("id_token");
    if (!idToken) throw new Error("O Google não devolveu o token de login.");
    return startSession(await call("/auth/google", { body: { idToken, nonce, inviteCode: inviteCode || undefined }, auth: false }));
  }

  const login = async (email, password) => startSession(await call("/auth/login", { body: { email, password }, auth: false }));
  const register = async (email, password, inviteCode, signupCode) =>
    startSession(await call("/auth/register", { body: { email, password, inviteCode: inviteCode || undefined, signupCode: signupCode || undefined }, auth: false }));

  async function logout() {
    await call("/auth/logout", { body: {} }).catch(() => {});
    await NexoStore.saveSettings({ session: null, teamId: null, teamName: null, inviteCode: null, teamRole: null, ...resetTeamState });
  }

  const createTeam = async (name) => { const t = await call("/teams", { body: { name } }); await useTeam(t); return t; };
  const joinTeam = async (code) => { const t = await call("/teams/join", { body: { code } }); await useTeam(t); return t; };
  const listTeams = async () => (await call("/me")).teams;
  const switchTeam = async (id) => { const t = (await listTeams()).find((x) => x.id === id); if (t) await useTeam(t); return t; };
  const teamInfo = async () => call(`/teams/${(await S()).teamId}`);
  const rotateInvite = async () => { const t = await call(`/teams/${(await S()).teamId}/invite/rotate`, { body: {} }); await NexoStore.saveSettings({ inviteCode: t.invite_code }); return t; };

  let running = null;
  function syncNow() { return (running ||= run().finally(() => (running = null))); }

  async function run() {
    const s = await S();
    if (!s.session?.token || !s.teamId) return { skipped: true };
    const lastPushed = { ...(s.lastPushed || {}) };
    const local = await chrome.storage.local.get(["contacts", "templates"]);
    const contacts = local.contacts || {};
    const templates = Object.fromEntries((local.templates || []).map((t) => [t.id, t]));

    // 1) Pull paginado: aplica registros remotos mais novos que os locais
    let cursor = s.syncCursor || "0";
    const incoming = [];
    for (let more = true; more;) {
      const page = await call(`/teams/${s.teamId}/records?after=${encodeURIComponent(cursor)}`);
      for (const r of page.rows) {
        const target = r.kind === "contact" ? contacts : templates;
        if ((target[r.id]?.updatedAt || 0) < r.updated_at) incoming.push(r);
        lastPushed[`${r.kind}:${r.id}`] = Math.max(lastPushed[`${r.kind}:${r.id}`] || 0, r.updated_at);
      }
      cursor = page.cursor;
      more = page.more;
    }

    // 2) Push: tudo que mudou localmente desde o último envio (o servidor descarta o que for mais antigo)
    const dirty = [
      ...Object.values(contacts).map((d) => ["contact", d]),
      ...Object.values(templates).map((d) => ["template", d])
    ].filter(([k, d]) => d.id && d.updatedAt && d.updatedAt > (lastPushed[`${k}:${d.id}`] || 0))
     .map(([kind, d]) => ({ kind, id: d.id, data: d, updated_at: d.updatedAt }));
    for (let i = 0; i < dirty.length; i += 500) await call(`/teams/${s.teamId}/records`, { body: { rows: dirty.slice(i, i + 500) } });
    dirty.forEach((r) => (lastPushed[`${r.kind}:${r.id}`] = r.updated_at));

    // Relê o estado atual antes de gravar: edições feitas durante a requisição não podem ser perdidas.
    if (incoming.length) {
      const now = await chrome.storage.local.get(["contacts", "templates"]);
      const c = now.contacts || {}, t = Object.fromEntries((now.templates || []).map((x) => [x.id, x]));
      for (const r of incoming) {
        const target = r.kind === "contact" ? c : t;
        if ((target[r.id]?.updatedAt || 0) < r.updated_at) target[r.id] = { ...r.data, updatedAt: r.updated_at };
      }
      await chrome.storage.local.set({ contacts: c, templates: Object.values(t) });
    }
    await NexoStore.saveSettings({ syncCursor: cursor, lastPushed, lastSyncAt: Date.now(), lastSyncError: null });
    return { pulled: incoming.length, pushed: dirty.length };
  }

  return { login, loginGoogle, register, logout, createTeam, joinTeam, listTeams, switchTeam, teamInfo, rotateInvite, syncNow };
})();

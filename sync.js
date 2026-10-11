// Sincronização em nuvem via Supabase (REST + RLS). Last-write-wins por registro usando updatedAt;
// o cursor de pull usa o relógio do servidor (server_ts) para não depender do relógio de cada máquina.
const NexoSync = (() => {
  const S = () => NexoStore.getSettings();

  async function call(path, { method = "GET", body, headers = {}, auth = true } = {}) {
    const s = await S();
    if (!s.supabaseUrl || !s.supabaseAnonKey) throw new Error("Configure a URL e a anon key do Supabase.");
    if (auth) await ensureFreshToken();
    const token = auth ? (await S()).session?.access_token : s.supabaseAnonKey;
    const res = await fetch(`${s.supabaseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: { apikey: s.supabaseAnonKey, Authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.msg || data?.message || data?.error_description || `Supabase HTTP ${res.status}`);
    return data;
  }

  const storeSession = (d) => NexoStore.saveSettings({
    session: { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + d.expires_in * 1000, user_id: d.user?.id, email: d.user?.email }
  });

  async function login(email, password) {
    // A senha só trafega nesta chamada; guardamos apenas os tokens da sessão.
    storeSession(await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password }, auth: false }));
  }

  async function ensureFreshToken() {
    const { session } = await S();
    if (!session) throw new Error("Faça login na aba Config.");
    if (session.expires_at - Date.now() > 60_000) return;
    await storeSession(await call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token }, auth: false }));
  }

  async function logout() { await NexoStore.saveSettings({ session: null, teamId: null, inviteCode: null, syncCursor: null, lastPushed: {} }); }

  async function createTeam(name) {
    const [team] = await call("/rest/v1/rpc/nexo_create_team", { method: "POST", body: { team_name: name } });
    await NexoStore.saveSettings({ teamId: team.id, inviteCode: team.invite_code, teamName: team.name, syncCursor: null, lastPushed: {} });
    return team;
  }

  async function joinTeam(code) {
    const [team] = await call("/rest/v1/rpc/nexo_join_team", { method: "POST", body: { code } });
    await NexoStore.saveSettings({ teamId: team.id, inviteCode: team.invite_code, teamName: team.name, syncCursor: null, lastPushed: {} });
    return team;
  }

  let running = null;
  function syncNow() { return (running ||= run().finally(() => (running = null))); }

  async function run() {
    const s = await S();
    if (!s.session || !s.teamId) return { skipped: true };
    const lastPushed = { ...(s.lastPushed || {}) };
    const local = await chrome.storage.local.get(["contacts", "templates"]);
    const contacts = local.contacts || {};
    const templates = Object.fromEntries((local.templates || []).map((t) => [t.id, t]));

    // 1) Pull: aplica registros remotos mais novos que os locais
    const rows = await call(`/rest/v1/nexo_records?team_id=eq.${s.teamId}` + (s.syncCursor ? `&server_ts=gt.${encodeURIComponent(s.syncCursor)}` : "") + "&order=server_ts.asc&limit=1000");
    let cursor = s.syncCursor;
    const incoming = [];
    for (const r of rows) {
      cursor = r.server_ts;
      const target = r.kind === "contact" ? contacts : templates;
      if ((target[r.id]?.updatedAt || 0) < r.updated_at) {
        incoming.push(r);
        lastPushed[`${r.kind}:${r.id}`] = r.updated_at;
      }
    }

    // 2) Push: tudo que mudou localmente desde o último envio
    const dirty = [
      ...Object.values(contacts).map((d) => ["contact", d]),
      ...Object.values(templates).map((d) => ["template", d])
    ].filter(([k, d]) => d.updatedAt && d.updatedAt > (lastPushed[`${k}:${d.id}`] || 0))
     .map(([kind, d]) => ({ team_id: s.teamId, kind, id: d.id, data: d, updated_at: d.updatedAt }));
    for (let i = 0; i < dirty.length; i += 200) {
      await call("/rest/v1/nexo_records?on_conflict=team_id,kind,id", {
        method: "POST", body: dirty.slice(i, i + 200), headers: { Prefer: "resolution=merge-duplicates,return=minimal" }
      });
    }
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

  return { login, logout, createTeam, joinTeam, syncNow };
})();

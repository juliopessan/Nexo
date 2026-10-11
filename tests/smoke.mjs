import fs from "fs"; import vm from "vm";
const N = process.argv[2] || new URL("..", import.meta.url).pathname;
const server = []; let ts = 0;
function fakeFetch(url, opt = {}) {
  const u = new URL(url); const ok = (d, s = 200) => Promise.resolve({ ok: s < 300, status: s, text: async () => JSON.stringify(d), json: async () => d });
  if (u.hostname === "api.anthropic.com") {
    const b = JSON.parse(opt.body);
    if (opt.headers["anthropic-dangerous-direct-browser-access"] !== "true" || b.fallbacks !== "default" || !b.output_config.format) return ok({ error: { message: "bad req" } }, 400);
    return ok({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ suggestions: ["a", "b", "c"] }) }] });
  }
  if (u.pathname.startsWith("/auth/v1/token")) return ok({ access_token: "t", refresh_token: "r", expires_in: 3600, user: { id: "u", email: "e@x" } });
  if (u.pathname.endsWith("nexo_create_team") || u.pathname.endsWith("nexo_join_team")) return ok([{ id: "T", name: "Time", invite_code: "abc" }]);
  if (u.pathname === "/rest/v1/nexo_records" && opt.method === "POST") {
    for (const r of JSON.parse(opt.body)) {
      const i = server.findIndex((x) => x.kind === r.kind && x.id === r.id);
      if (i >= 0 && r.updated_at < server[i].updated_at) continue; // trigger LWW
      const row = { ...r, server_ts: String(++ts).padStart(6, "0") };
      if (i >= 0) server[i] = row; else server.push(row);
    }
    return ok(null);
  }
  if (u.pathname === "/rest/v1/nexo_records") {
    const gt = (u.searchParams.get("server_ts") || "gt.").slice(3);
    return ok(server.filter((r) => r.server_ts > gt).sort((a, b) => a.server_ts.localeCompare(b.server_ts)));
  }
  throw new Error("unexpected " + url);
}
function client() {
  const data = {};
  const chrome = { storage: { local: {
    get: async (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])),
    set: async (o) => Object.assign(data, structuredClone(o)) } } };
  const ctx = vm.createContext({ chrome, fetch: fakeFetch, URLSearchParams, console, Date, JSON, Promise, setTimeout });
  for (const f of ["store.js", "ai.js", "sync.js"]) vm.runInContext(fs.readFileSync(`${N}/${f}`, "utf8").replace(/^const (\w+) =/m, "globalThis.$1 ="), ctx);
  return ctx;
}
const assert = (c, m) => { if (!c) { console.error("FAIL", m); process.exit(1); } console.log("ok ", m); };
const A = client(), B = client();
for (const c of [A, B]) { await c.NexoStore.saveSettings({ supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "k", anthropicKey: "sk" }); await c.NexoSync.login("e", "p"); }
await A.NexoSync.createTeam("Time"); await B.NexoSync.joinTeam("abc");
await A.NexoStore.upsertContact({ id: "ana", name: "Ana Souza", headline: "CTO" });
await A.NexoSync.syncNow(); await B.NexoSync.syncNow();
assert((await B.NexoStore.get()).contacts.ana?.name === "Ana Souza", "B recebe contato criado por A");
await new Promise((r) => setTimeout(r, 5));
await B.NexoStore.patchContact("ana", { stage: "Reunião" });
await B.NexoSync.syncNow(); await A.NexoSync.syncNow();
assert((await A.NexoStore.get()).contacts.ana.stage === "Reunião", "A recebe mudança de etapa feita por B");
const r = await A.NexoSync.syncNow();
assert(r.pushed === 0, "sem eco: nada reenviado após pull");
await new Promise((r) => setTimeout(r, 5));
await A.NexoStore.deleteContact("ana");
await A.NexoSync.syncNow(); await B.NexoSync.syncNow();
assert(!(await B.NexoStore.get()).contacts.ana, "exclusão propaga via tombstone");
await A.NexoStore.saveTemplates([]);
await A.NexoSync.syncNow(); await B.NexoSync.syncNow();
assert((await B.NexoStore.get()).templates.length === 0, "remoção de templates propaga");
const s = await A.NexoAI.suggest("comment", { postText: "Post sobre IA" });
assert(s.length === 3, "IA devolve 3 sugestões (headers/fallbacks/schema corretos)");

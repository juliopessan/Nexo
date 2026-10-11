// Ponta a ponta: 2 clientes da extensão (store.js + sync.js reais, chrome.storage simulado)
// sincronizando através do servidor real (server/) com PostgreSQL real (DATABASE_URL).
// A API da Anthropic é simulada (não gasta créditos).
import fs from "fs"; import vm from "vm";
const root = new URL("..", import.meta.url).pathname;
process.env.SIGNUP_CODE = "e2e-signup";
const { server, pool, migrate } = await import(`${root}server/index.js`);
await pool.query("drop table if exists nexo_records, nexo_team_members, nexo_teams, nexo_sessions, nexo_users cascade");
await migrate();
await new Promise((r) => server.listen(0, r));
const serverUrl = `http://127.0.0.1:${server.address().port}`;

function fakeAnthropic(url, opt) {
  const b = JSON.parse(opt.body);
  const ok = opt.headers["anthropic-dangerous-direct-browser-access"] === "true" && b.fallbacks === "default" && b.output_config?.format?.type === "json_schema";
  const body = ok ? { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ suggestions: ["a", "b", "c"] }) }] } : { error: { message: "bad request" } };
  return Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => body });
}

function client() {
  const data = {};
  const chrome = { storage: { local: {
    get: async (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])),
    set: async (o) => Object.assign(data, structuredClone(o)) } } };
  const f = (url, opt) => (String(url).startsWith("https://api.anthropic.com") ? fakeAnthropic(url, opt) : fetch(url, opt));
  const ctx = vm.createContext({ chrome, fetch: f, URLSearchParams, console, Date, JSON, Promise, setTimeout, encodeURIComponent });
  for (const file of ["store.js", "ai.js", "sync.js"])
    vm.runInContext(fs.readFileSync(`${root}${file}`, "utf8").replace(/^const (\w+) =/m, "globalThis.$1 ="), ctx);
  return ctx;
}
let failed = false;
const assert = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };
const tick = () => new Promise((r) => setTimeout(r, 5));

try {
  const A = client(), B = client();
  for (const c of [A, B]) await c.NexoStore.saveSettings({ serverUrl, anthropicKey: "sk-test" });
  await A.NexoSync.register("ana@acme.com", "senha-forte-1", "", "e2e-signup");
  const team = await A.NexoSync.createTeam("Vendas");
  await B.NexoSync.register("bia@acme.com", "senha-forte-2", team.invite_code, "");
  assert((await B.NexoStore.getSettings()).teamId === team.id, "B entra na equipe pelo convite no cadastro");

  await A.NexoStore.upsertContact({ id: "ana-souza", name: "Ana Souza", headline: "CTO" });
  await A.NexoSync.syncNow(); await B.NexoSync.syncNow();
  assert((await B.NexoStore.get()).contacts["ana-souza"]?.name === "Ana Souza", "B recebe contato criado por A");

  await tick();
  await B.NexoStore.patchContact("ana-souza", { stage: "Reunião" });
  await B.NexoSync.syncNow(); await A.NexoSync.syncNow();
  assert((await A.NexoStore.get()).contacts["ana-souza"].stage === "Reunião", "A recebe mudança de etapa feita por B");
  assert((await A.NexoSync.syncNow()).pushed === 0, "sem eco: nada reenviado após o pull");

  // Edição offline concorrente: a mais recente vence nos dois lados
  await tick(); await A.NexoStore.patchContact("ana-souza", { notes: "da Ana" });
  await tick(); await B.NexoStore.patchContact("ana-souza", { notes: "da Bia (mais recente)" });
  await A.NexoSync.syncNow(); await B.NexoSync.syncNow(); await A.NexoSync.syncNow();
  const na = (await A.NexoStore.get()).contacts["ana-souza"].notes, nb = (await B.NexoStore.get()).contacts["ana-souza"].notes;
  assert(na === nb && nb === "da Bia (mais recente)", "conflito: edição mais recente vence e os dois convergem");

  await tick(); await A.NexoStore.deleteContact("ana-souza");
  await A.NexoSync.syncNow(); await B.NexoSync.syncNow();
  assert(!(await B.NexoStore.get()).contacts["ana-souza"], "exclusão de contato propaga");

  await A.NexoStore.saveTemplates([]);
  await A.NexoSync.syncNow(); await B.NexoSync.syncNow();
  assert((await B.NexoStore.get()).templates.length === 0, "remoção de templates propaga");

  for (let i = 0; i < 1200; i++) await A.NexoStore.upsertContact({ id: `lead-${i}`, name: `Lead ${i}` });
  await A.NexoSync.syncNow(); await B.NexoSync.syncNow();
  assert(Object.keys((await B.NexoStore.get()).contacts).length === 1200, "1.200 contatos: push em lotes e pull paginado");

  await A.NexoSync.logout();
  const r = await A.NexoSync.syncNow();
  assert(r.skipped, "após logout não sincroniza");

  assert((await A.NexoAI.suggest("comment", { postText: "Post sobre IA" })).length === 3, "IA: request com headers, fallbacks e schema corretos");
} finally {
  server.close(); await pool.end();
}
process.exit(failed ? 1 : 0);

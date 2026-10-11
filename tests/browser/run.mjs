// Teste em Chromium real com a extensão carregada; linkedin.com e api.anthropic.com são interceptados.
import { chromium } from "playwright-core";
import fs from "fs"; import os from "os"; import path from "path";
import * as fx from "./fixtures.js";

const ext = path.resolve(new URL("../..", import.meta.url).pathname);
const errors = [];
let failed = false;
const check = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };

const dialogs = [];
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "nexo-")), {
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new"]
});
let aiCalls = 0;
await ctx.route("https://www.linkedin.com/**", (route) => {
  const u = new URL(route.request().url());
  const newUi = u.searchParams.has("newui");
  const body = u.pathname.startsWith("/notifications") && u.searchParams.has("hard") ? fx.notificationsHard
    : u.pathname.startsWith("/notifications") ? fx.notifications
    : u.pathname.startsWith("/feed/update/urn:li:activity:7001") ? fx.tokenPost
    : u.pathname.startsWith("/feed/update/urn:li:activity:99") ? fx.myPost
    : u.pathname.startsWith("/messaging") && u.searchParams.has("list") ? fx.inboxList
    : u.pathname.startsWith("/messaging/thread/2-abc") ? fx.inboxList
    : u.pathname.startsWith("/in/") ? fx.profile
    : u.pathname.startsWith("/messaging") ? (newUi ? fx.messagingNewUi : fx.messaging)
    : (newUi ? fx.feedNewUi : fx.feed);
  route.fulfill({ contentType: "text/html; charset=utf-8", body });
});
let exaBody = null;
await ctx.route("https://api.exa.ai/**", (route) => {
  exaBody = JSON.parse(route.request().postData());
  route.fulfill({ contentType: "application/json", body: JSON.stringify({
    results: [{ title: "Maria Silva", url: "https://www.linkedin.com/in/maria-silva/" }],
    output: {
      content: { email: "", company_name: "Acme Vendas", company_domain: "https://www.acme.com.br/", industry: "Software B2B", employees: "51-200",
        company_location: "São Paulo, BR", company_description: "Plataforma de automação comercial.", person_summary: "Lidera vendas B2B com foco em IA.", interests: ["IA em vendas", "SDR"] },
      grounding: [{ field: "company_name", citations: [{ url: "https://www.acme.com.br/sobre", title: "Sobre" }], confidence: "high" }]
    },
    costDollars: { total: 0.012 } }) });
});
await ctx.route("https://api.anthropic.com/**", (route) => {
  aiCalls++;
  route.fulfill({ contentType: "application/json", body: JSON.stringify({
    stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ suggestions: ["Sugestão IA um", "Sugestão IA dois", "Sugestão IA três"] }) }] }) });
});

let [sw] = ctx.serviceWorkers();
sw ||= await ctx.waitForEvent("serviceworker");
const extId = sw.url().split("/")[2];
sw.on("console", (m) => m.type() === "error" && errors.push(`sw: ${m.text()}`));
const storage = (k) => sw.evaluate((k) => chrome.storage.local.get(k), k);
const watch = (p, name) => { p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`)); p.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`)); return p; };

// 1) Perfil
const page = watch(await ctx.newPage(), "page");
await page.goto("https://www.linkedin.com/in/julio-pessan/");
await page.waitForSelector("#nexo-profile-bar", { timeout: 5000 }).catch(() => {});
check(await page.isVisible("#nexo-profile-bar"), "perfil: barra do Nexo aparece");
await page.click("#nexo-profile-bar >> text=+ Salvar contato");
await page.waitForTimeout(300);
let { contacts = {} } = await storage("contacts");
const j = contacts["julio-pessan"];
check(j?.name === "Julio Pessan" && j?.headline === "AI Solutions Architect" && j?.company === "Avanade", `perfil: contato salvo com nome/cargo/empresa (${JSON.stringify(j && { n: j.name, h: j.headline, c: j.company })})`);
check(await page.isVisible("#nexo-profile-bar >> text=No Nexo · Novo"), "perfil: barra muda para 'No Nexo · Novo'");

// 2) Feed
await page.goto("https://www.linkedin.com/feed/");
await page.waitForSelector(".nexo-post-bar", { timeout: 5000 }).catch(() => {});
check(await page.isVisible(".nexo-post-bar"), "feed: barra de ações no post");
await page.click("text=＋ Autor no CRM");
await page.waitForTimeout(300);
({ contacts = {} } = await storage("contacts"));
check(contacts["maria-silva"]?.name === "Maria Silva", `feed: autor salvo (${contacts["maria-silva"]?.name})`);
await page.click(".nexo-post-bar >> text=👍 Curtir");
await page.waitForTimeout(300);
check(await page.getAttribute("button.react-button__trigger", "aria-pressed") === "true", "feed: curtir aciona o botão nativo");
await page.click("text=💬 Comentar com template");
await page.waitForSelector(".nexo-menu button", { timeout: 3000 }).catch(() => {});
await page.click(".nexo-menu >> text=Comentário de valor");
await page.waitForTimeout(500);
const c1 = await page.textContent(".ql-editor");
check(c1.startsWith("Excelente ponto, Maria!"), `feed: template de comentário inserido ("${c1}")`);

await sw.evaluate(() => chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, anthropicKey: "sk-test" } })));
await page.click("text=✨ Comentar com IA");
await page.waitForSelector(".nexo-menu >> text=Sugestão IA dois", { timeout: 5000 }).catch(() => {});
await page.click(".nexo-menu >> text=Sugestão IA dois").catch(() => {});
await page.waitForTimeout(500);
check((await page.textContent(".ql-editor")) === "Sugestão IA dois", "feed: sugestão de IA inserida no comentário");

// 3) Mensagens
await page.goto("https://www.linkedin.com/messaging/thread/1/");
await page.waitForSelector("text=⚡ Templates Nexo", { timeout: 5000 }).catch(() => {});
await page.click("text=⚡ Templates Nexo");
await page.click(".nexo-menu >> text=Primeiro contato");
await page.waitForTimeout(400);
const dm = await page.textContent(".msg-form__contenteditable");
check(dm.startsWith("Oi Maria, tudo bem? Vi seu trabalho como Head de Vendas"), `DM: template com variáveis ("${dm.slice(0, 60)}…")`);
await page.click("text=✨ Responder com IA");
await page.click(".nexo-menu >> text=Sugestão IA um").catch(() => {});
await page.waitForTimeout(400);
check((await page.textContent(".msg-form__contenteditable")) === "Sugestão IA um", "DM: resposta de IA inserida");
check(aiCalls === 2, `IA chamada 2 vezes até aqui (${aiCalls})`);

// 3b) Interface nova (sem as classes antigas)
await page.goto("https://www.linkedin.com/feed/?newui=1");
await page.waitForSelector(".nexo-post-bar", { timeout: 5000 }).catch(() => {});
check(await page.isVisible(".nexo-post-bar"), "UI nova: barra de ações no post");
await page.click("text=＋ Autor no CRM").catch(() => {});
await page.waitForTimeout(300);
({ contacts = {} } = await storage("contacts"));
const cl = contacts["carlos-lima"];
check(cl?.name === "Carlos Lima" && cl?.headline === "CEO na Lima Tech", `UI nova: autor salvo com cargo (${JSON.stringify(cl && { n: cl.name, h: cl.headline })})`);
await page.click(".nexo-post-bar >> text=👍 Curtir").catch(() => {});
await page.waitForTimeout(300);
check(await page.getAttribute('button[aria-label="Reagir com Gostei"]', "aria-pressed") === "true", "UI nova: curtir funciona");
await page.click("text=✨ Comentar com IA").catch(() => {});
await page.click(".nexo-menu >> text=Sugestão IA três").catch(() => {});
await page.waitForTimeout(500);
check((await page.textContent('[role="textbox"]')) === "Sugestão IA três", "UI nova: comentário de IA inserido");
await page.goto("https://www.linkedin.com/messaging/thread/2/?newui=1");
await page.waitForSelector("text=⚡ Templates Nexo", { timeout: 5000 }).catch(() => {});
await page.click("text=⚡ Templates Nexo").catch(() => {});
await page.click(".nexo-menu >> text=Follow-up").catch(() => {});
await page.waitForTimeout(400);
const dm2 = await page.textContent('[aria-label="Escreva uma mensagem…"]');
check(dm2.startsWith("Oi Carlos!"), `UI nova: template de DM inserido ("${dm2.slice(0, 30)}…")`);

// 5) Engajamento: "Este sou eu" → comentários sem resposta nos MEUS posts e DMs não lidas entram na fila
await page.goto("https://www.linkedin.com/in/julio-pessan/");
await page.click("#nexo-profile-bar >> text=⭐ Este sou eu");
await page.waitForTimeout(300);
check((await storage("settings")).settings?.me?.id === "julio-pessan", "engajamento: 'Este sou eu' define o perfil do usuário");
await page.goto("https://www.linkedin.com/feed/update/urn:li:activity:99/");
await page.waitForSelector(".nexo-comment-bar", { timeout: 5000 }).catch(() => {});
check((await page.$$(".nexo-comment-bar")).length === 3, `comentários: botões em cada comentário (${(await page.$$(".nexo-comment-bar")).length})`);
await page.waitForTimeout(800);
let { queue = {} } = await storage("queue");
const open = Object.values(queue).filter((q) => q.status === "open" && q.kind === "comment");
check(open.length === 1 && open[0].author.name === "Ana Costa", `fila: só o comentário sem resposta (${open.map((q) => q.author.name)})`);
check(open[0]?.postText?.includes("Lançamos o Nexo"), "fila: guarda o texto do post como contexto");

// Responder com IA direto no comentário: mantém a menção @nome e anexa o texto
const ana = 'article[data-id="urn:li:comment:(activity:99,1)"]';
await page.click(`${ana} >> text=✨ Responder com IA`);
await page.click(".nexo-menu >> text=Sugestão IA um").catch(() => {});
await page.waitForTimeout(500);
const reply = await page.textContent(`${ana} > .reply-box [contenteditable]`);
check(reply === "Ana Costa Sugestão IA um", `comentário: resposta inserida após a menção ("${reply}")`);
({ queue = {} } = await storage("queue"));
check(queue["c:99:1"]?.status === "done", "fila: item marcado como feito após responder");
await page.click(`${ana} .nexo-comment-bar >> text=👍`);
check(await page.getAttribute(`${ana} button[aria-label^="Reagir"]`, "aria-pressed") === "true", "comentário: curtir aciona o botão nativo");

// DMs não lidas
await page.goto("https://www.linkedin.com/messaging/?list=1");
await page.waitForTimeout(800);
({ queue = {} } = await storage("queue"));
const dms = Object.values(queue).filter((q) => q.kind === "dm");
check(dms.length === 1 && dms[0].author.name === "Paula Nunes" && dms[0].text.includes("piloto"), `fila: só a DM não lida (${dms.map((q) => q.author.name)})`);

// 6) Notificações (estrutura do texto real): comentário vira item da fila; reações não
await page.goto("https://www.linkedin.com/notifications/?filter=my_posts_all");
await page.waitForTimeout(900);
({ queue = {} } = await storage("queue"));
const nq = queue["c:7001:7002"];
check(nq?.author?.name === "Kosta Z." && nq.text.startsWith("I work solo"), `notificações: comentário do Kosta na fila (${JSON.stringify(nq && { a: nq.author.name, t: nq.text.slice(0, 20) })})`);
check(nq?.postText?.startsWith("Nobody notices"), "notificações: texto do post guardado como contexto");
check(Object.values(queue).filter((q) => q.source === "notification").length === 1, "notificações: reações não viram itens");
check((await page.$$("article.nt-card .nexo-post-bar")).length === 1, "notificações: botão de IA só no card de comentário");
await page.click("article.nt-card >> text=✨ Responder com IA");
await page.click(".nexo-menu >> text=Sugestão IA dois");
await page.waitForURL(/activity:7001/, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1500);
const kz = await page.textContent('article[data-id*="7002"] .reply-box [contenteditable]').catch(() => "");
check(kz === "Kosta Z. Sugestão IA dois", `notificações → post: resposta inserida no comentário certo ("${kz}")`);
({ queue = {} } = await storage("queue"));
check(queue["c:7001:7002"]?.status === "done", "notificações: item marcado como feito");

// 6b) Notificações "difíceis" (estrutura sem classes conhecidas) + diagnóstico da aba
await page.goto("https://www.linkedin.com/notifications/?hard=1");
await page.waitForTimeout(900);
({ queue = {} } = await storage("queue"));
const lia = queue["c:9001:9002"];
check(lia?.author?.name === "Lia Prado" && lia.text.startsWith("Esse ponto") && lia.priority === 1, `notificações sem classes: comentário reconhecido (${JSON.stringify(lia && { a: lia.author.name, t: lia.text.slice(0, 15), p: lia.priority })})`);
check(!Object.values(queue).some((q) => q.author?.name === "Rui"), "notificações sem classes: reação ignorada");
const tabId = await sw.evaluate(() => chrome.tabs.query({ url: "https://www.linkedin.com/notifications/*" }).then((t) => t[0].id));
const diag = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "nexo:diagnose" }), tabId);
check(diag?.counts?.notifParsed === 1 && diag.notifSamples[0].headline === "<nome> commented on your post.", `diagnóstico: relatório sem dados pessoais (${JSON.stringify(diag?.notifSamples?.[0])})`);

// 4) Painel lateral
const panel = watch(await ctx.newPage(), "panel");
panel.on("dialog", (d) => { dialogs.push(d.message()); d.accept().catch(() => {}); });
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await panel.waitForTimeout(500);
check(await panel.isVisible("#inbox"), "painel: abre na Caixa de entrada");
await panel.click("nav >> text=Pessoas");
await panel.waitForTimeout(300);
const names = await panel.$$eval("#list .card b", (els) => els.map((e) => e.textContent));
check(["Julio Pessan", "Maria Silva", "Carlos Lima"].every((n) => names.includes(n)), `painel: lista mostra os contatos (${names})`);
await panel.click("nav >> text=Pipeline");
check(await panel.isVisible('.col[data-stage="Novo"] >> text=Julio Pessan'), "painel: pipeline mostra contato em 'Novo'");
await panel.dragAndDrop('.col[data-stage="Novo"] .card[data-id="julio-pessan"]', '.col[data-stage="Reunião"]');
await panel.waitForTimeout(400);
({ contacts = {} } = await storage("contacts"));
check(contacts["julio-pessan"].stage === "Reunião", `painel: arrastar muda etapa (${contacts["julio-pessan"].stage})`);
await panel.click("nav >> text=Pessoas");
await panel.click('#list .card[data-id="maria-silva"]');
const hist = await panel.textContent("#detail");
check(hist.includes("Curtiu um post") && hist.includes("Comentário sugerido por IA inserido"), "painel: histórico registra curtida e comentário");
// Enriquecimento com Exa a partir do detalhe do contato
await sw.evaluate(() => chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, exaKey: "exa-test" } })));
await panel.click("#enrich");
await panel.waitForTimeout(800);
const det = await panel.textContent("#detail");
check(det.includes("Lidera vendas B2B") && det.includes("acme.com.br") && det.includes("IA em vendas"), "Exa: resumo, domínio e temas aparecem no contato");
check(exaBody?.outputSchema && exaBody.category === "people" && /maria-silva/.test(exaBody.query) && /Nunca deduza/.test(exaBody.systemPrompt), "Exa: request com outputSchema, categoria people e regra contra e-mail deduzido");
({ contacts = {} } = await storage("contacts"));
check(!contacts["maria-silva"].email, "Exa: e-mail vazio não é gravado");
await panel.click("#back");

// Prioridade: seus posts e DMs no topo, com selo
await sw.evaluate(() => chrome.storage.local.get("queue").then(({ queue }) => {
  queue["c:outro"] = { id: "c:outro", kind: "comment", status: "open", priority: 2, seenAt: Date.now() + 1e6, author: { name: "Zé Menção" }, text: "Te mencionei", url: "https://www.linkedin.com/feed/update/urn:li:activity:5/" };
  return chrome.storage.local.set({ queue }); }));

// Caixa de entrada: reabre o comentário (para testar o fluxo do painel), gera rascunhos e "Abrir e inserir"
await sw.evaluate(() => chrome.storage.local.get("queue").then(({ queue }) => {
  queue["c:99:1"].status = "open"; return chrome.storage.local.set({ queue }); }));
await panel.click("nav >> text=Caixa de entrada");
await panel.waitForTimeout(300);
const qNames = await panel.$$eval(".qi header b", (els) => els.map((e) => e.textContent));
check(qNames.includes("Ana Costa") && qNames.includes("Paula Nunes"), `inbox: lista comentário e DM (${qNames})`);
check(qNames.at(-1) === "Zé Menção", `prioridade: item de outro post fica por último mesmo sendo o mais recente (${qNames})`);
check((await panel.$$(".qi .prio")).length >= 2, "prioridade: selos 'Seu post' / 'Sua DM' aparecem");
const goalsTxt = await panel.textContent("#goals");
check(/Respostas/.test(goalsTxt) && /DMs/.test(goalsTxt), `inbox: metas do dia visíveis (${goalsTxt.replace(/\s+/g, " ").trim()})`);
const anaItem = '.qi[data-q="c:99:1"]';
await panel.click(`${anaItem} >> text=✨ Gerar respostas`);
await panel.waitForSelector(`${anaItem} .drafts button`, { timeout: 5000 }).catch(() => {});
await panel.click(`${anaItem} .drafts >> text=Sugestão IA dois`);
await panel.fill(`${anaItem} textarea`, "Funciona sim, Ana! Te mostro numa call?");
await page.goto("https://www.linkedin.com/feed/");
await page.bringToFront();
await panel.click(`${anaItem} >> text=Abrir e inserir`);
await page.waitForURL(/activity:99/, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1500);
const inserted = await page.textContent(`${ana} > .reply-box [contenteditable]`).catch(() => "");
check(inserted === "Ana Costa Funciona sim, Ana! Te mostro numa call?", `abrir e inserir: rascunho editado chega no comentário ("${inserted}")`);
const { stats = {} } = await storage("stats");
const st = Object.values(stats)[0] || {};
check(st.reply === 3 && st.like >= 3 && st.comment >= 2 && st.dm >= 2, `metas: contagem do dia (${JSON.stringify(st)})`);

await panel.click("nav >> text=Config");
check(await panel.isVisible("#serverForm"), "painel: aba Config abre");

// 7) Ponte com a tarefa agendada do Claude
await panel.click("#bridgeOn");
await panel.waitForTimeout(300);
const token = (await storage("settings")).settings.bridgeToken;
const snippet = await panel.inputValue("#bridgeSnippet");
check(token?.length === 36 && snippet.includes(token) && snippet.includes("nexo:import"), "ponte: token gerado e instruções com o token");
await page.goto("https://www.linkedin.com/feed/");
await page.waitForTimeout(500);
const send = (tok, items) => page.evaluate(([tok, items]) => new Promise((res) => {
  const on = (e) => { if (e.data?.type === "nexo:import:result") { removeEventListener("message", on); res(e.data); } };
  addEventListener("message", on);
  window.postMessage({ type: "nexo:import", token: tok, items }, "*");
  setTimeout(() => res(null), 3000);
}), [tok, items]);
const triage = [
  { kind: "dm", url: "https://www.linkedin.com/messaging/thread/2-rec/", author: { name: "Laura Recruiter", headline: "Talent @ Globex" },
    text: "Hi Julio, we have a Lead GenAI Architect role, 100% remote.", classification: "recrutador", urgency: 1, why: "Vaga remota, sem faixa", draft: "Thanks Laura! What is the USD range and is it fully remote?" },
  { kind: "comment", url: "https://www.linkedin.com/feed/update/urn:li:activity:8001/?commentUrn=urn%3Ali%3Acomment%3A%28activity%3A8001%2C8002%29",
    author: { name: "Pedro Lead" }, text: "Vocês fazem isso para bancos?", classification: "lead", urgency: 1, draft: "Fazemos sim, Pedro. Te chamo por DM?" },
  { kind: "dm", url: "https://evil.example.com/phish", author: { name: "X" }, text: "clique aqui", draft: "ok" },
  { kind: "invite", url: "https://www.linkedin.com/in/ana-convite/", author: { name: "Ana Convite", headline: "CTO" }, text: "Nota: adorei seu post", classification: "peer", urgency: 3 }
];
check((await send("errado", triage))?.ok === false, "ponte: token errado é recusado");
({ queue = {} } = await storage("queue"));
check(!Object.keys(queue).some((k) => k.startsWith("dm:/messaging/thread/2-rec")), "ponte: nada entra com token errado");
const r = await send(token, triage);
check(r?.ok && r.accepted === 3 && r.rejected === 1, `ponte: aceita 3 e rejeita link fora do LinkedIn (${JSON.stringify(r)})`);
({ queue = {} } = await storage("queue"));
check(queue["dm:/messaging/thread/2-rec"]?.draft?.startsWith("Thanks Laura") && queue["c:8001:8002"]?.classification === "lead", "ponte: ids compatíveis com os do Nexo (DM e comentário)");
await panel.click("nav >> text=Caixa de entrada");
await panel.waitForTimeout(400);
const laura = '.qi[data-q="dm:/messaging/thread/2-rec"]';
check(await panel.isVisible(`${laura} >> text=Recrutador`) && await panel.isVisible(`${laura} >> text=Claude`), "ponte: selos de classificação e origem no painel");
check((await panel.inputValue(`${laura} textarea`)).startsWith("Thanks Laura"), "ponte: rascunho da triagem já pronto para 'Abrir e inserir'");
check(!(await panel.isVisible('.qi[data-q^="t:"] >> text=✨ Gerar respostas')), "ponte: convite sem botão de gerar");

// 8) Cadastro no servidor real (quando há DATABASE_URL): Enter na aba "Criar conta" cria a conta
if (process.env.DATABASE_URL) {
  process.env.SIGNUP_CODE = "codigo-fundador";
  const srv = await import("../../server/index.js");
  await srv.pool.query("drop table if exists nexo_records, nexo_team_members, nexo_teams, nexo_sessions, nexo_users cascade");
  await srv.migrate();
  await new Promise((r) => srv.server.listen(0, r));
  const url = `http://127.0.0.1:${srv.server.address().port}`;
  await sw.evaluate((url) => chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, serverUrl: url } })), url);
  await panel.reload();
  await panel.click("nav >> text=Config");
  await panel.waitForSelector("#authForm", { timeout: 5000 });
  check(await panel.isVisible('#authMode button.on >> text=Criar conta'), "cadastro: abre na aba Criar conta");
  check(await panel.isVisible("#googleBtn >> text=Entrar com Google"), "Google: botão Entrar com Google visível");
  await panel.click("#googleBtn");
  await panel.waitForTimeout(800);
  check(!(await storage("settings")).settings.session, "Google: sem GOOGLE_CLIENT_ID no servidor, não cria sessão (erro explicado)");
  await panel.fill('#authForm [name="email"]', "julio.pessan.pessan@gmail.com");
  await panel.fill('#authForm [name="password"]', "senha-bem-forte");
  await panel.fill('#authForm [name="signupCode"]', "codigo-fundador");
  await panel.press('#authForm [name="signupCode"]', "Enter");
  await panel.waitForTimeout(1500);
  let st = (await storage("settings")).settings;
  check(st.session?.email === "julio.pessan.pessan@gmail.com", `cadastro: Enter cria a conta (${st.session?.email})`);
  await panel.fill("#newTeam [name=name]", "Julio");
  await panel.click("#newTeam button");
  await panel.waitForTimeout(1500);
  st = (await storage("settings")).settings;
  check(st.teamName === "Julio" && st.lastSyncAt, "cadastro: equipe criada e primeira sincronização feita");
  await panel.click("#logout");
  await panel.waitForTimeout(800);
  await panel.click('#authMode >> text=Já tenho conta');
  await panel.fill('#authForm [name="email"]', "julio.pessan.pessan@gmail.com");
  await panel.fill('#authForm [name="password"]', "senha-bem-forte");
  await panel.press('#authForm [name="password"]', "Enter");
  await panel.waitForTimeout(1500);
  check((await storage("settings")).settings.session?.email === "julio.pessan.pessan@gmail.com", "login: aba Já tenho conta entra com a conta criada");
  // 9) Persistência: cofre no servidor restaura as configurações após "reinstalar" (storage apagado)
  await sw.evaluate(() => chrome.storage.local.get("settings").then(({ settings }) =>
    chrome.storage.local.set({ settings: { ...settings, anthropicKey: "sk-vault", tone: "direto", exaKey: "exa-vault", vaultUpdatedAt: Date.now() } })));
  await sw.evaluate(() => NexoPersist.pushVault());
  const serverUrl = (await storage("settings")).settings.serverUrl;
  await sw.evaluate((u) => chrome.storage.local.clear().then(() => chrome.storage.local.set({ settings: { serverUrl: u, freshInstall: true } })), serverUrl);
  check(!(await sw.evaluate(() => NexoPersist.writeBackupFile())), "persistência: instalação nova não sobrescreve o arquivo de backup");
  await panel.reload();
  await panel.waitForTimeout(400);
  check(await panel.isVisible("#restoreBanner"), "persistência: aviso de restauração na instalação nova");
  await panel.click("#restoreLogin");
  await panel.waitForSelector('#authMode >> text=Já tenho conta', { timeout: 5000 });
  await panel.click('#authMode >> text=Já tenho conta');
  await panel.fill('#authForm [name="email"]', "julio.pessan.pessan@gmail.com");
  await panel.fill('#authForm [name="password"]', "senha-bem-forte");
  await panel.press('#authForm [name="password"]', "Enter");
  await panel.waitForTimeout(2000);
  const rs = (await storage("settings")).settings;
  check(rs.anthropicKey === "sk-vault" && rs.tone === "direto" && rs.exaKey === "exa-vault", `persistência: chaves e tom restaurados do servidor no login (${rs.anthropicKey}, ${rs.tone})`);
  check(dialogs.some((m) => /restauradas do servidor/.test(m)), "persistência: usuário é avisado da restauração");
  srv.server.close(); await srv.pool.end();
}

// 10) Backup em arquivo + restauração pelo aviso
check(await sw.evaluate(() => NexoPersist.writeBackupFile()) === true, "backup: arquivo Downloads/Nexo/nexo-backup.json gravado");
const backupJson = await sw.evaluate(() => chrome.storage.local.get(null).then((all) => JSON.stringify({ nexoBackup: 1, at: new Date().toISOString(), data: { ...all, settings: { ...all.settings, anthropicKey: "sk-arquivo", freshInstall: false } } })));
await sw.evaluate(() => chrome.storage.local.clear().then(() => chrome.storage.local.set({ settings: { freshInstall: true } })));
await panel.reload();
await panel.waitForTimeout(400);
await panel.setInputFiles("#restoreFile", { name: "nexo-backup.json", mimeType: "application/json", buffer: Buffer.from(backupJson) });
await panel.waitForTimeout(800);
const rf = (await storage("settings")).settings;
check(rf.anthropicKey === "sk-arquivo" && !rf.freshInstall && !(await panel.isVisible("#restoreBanner")), "backup: restaurar do arquivo pelo aviso recupera tudo");

check(sw.url().startsWith("chrome-extension://lgeenajlpmgihmgnobifccidbccooahc/"), `ID fixo da extensão (${extId})`);
check(dialogs.some((m) => /GOOGLE_CLIENT_ID/.test(m)) || !process.env.DATABASE_URL, "Google: mensagem explica que falta configurar o servidor");

check(errors.length === 0, `sem erros de JS (${errors.length})`);
errors.forEach((e) => console.log("   ", e));
await ctx.close();
process.exit(failed ? 1 : 0);

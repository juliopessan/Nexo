// Teste em Chromium real com a extensão carregada; linkedin.com e api.anthropic.com são interceptados.
import { chromium } from "playwright-core";
import fs from "fs"; import os from "os"; import path from "path";
import * as fx from "./fixtures.js";

const ext = path.resolve(new URL("../..", import.meta.url).pathname);
const errors = [];
let failed = false;
const check = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) failed = true; };

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "nexo-")), {
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new"]
});
let aiCalls = 0;
await ctx.route("https://www.linkedin.com/**", (route) => {
  const u = new URL(route.request().url());
  const newUi = u.searchParams.has("newui");
  const body = u.pathname.startsWith("/feed/update/urn:li:activity:99") ? fx.myPost
    : u.pathname.startsWith("/messaging") && u.searchParams.has("list") ? fx.inboxList
    : u.pathname.startsWith("/messaging/thread/2-abc") ? fx.inboxList
    : u.pathname.startsWith("/in/") ? fx.profile
    : u.pathname.startsWith("/messaging") ? (newUi ? fx.messagingNewUi : fx.messaging)
    : (newUi ? fx.feedNewUi : fx.feed);
  route.fulfill({ contentType: "text/html; charset=utf-8", body });
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
check(queue["c:urn:li:comment:(activity:99,1)"]?.status === "done", "fila: item marcado como feito após responder");
await page.click(`${ana} .nexo-comment-bar >> text=👍`);
check(await page.getAttribute(`${ana} button[aria-label^="Reagir"]`, "aria-pressed") === "true", "comentário: curtir aciona o botão nativo");

// DMs não lidas
await page.goto("https://www.linkedin.com/messaging/?list=1");
await page.waitForTimeout(800);
({ queue = {} } = await storage("queue"));
const dms = Object.values(queue).filter((q) => q.kind === "dm");
check(dms.length === 1 && dms[0].author.name === "Paula Nunes" && dms[0].text.includes("piloto"), `fila: só a DM não lida (${dms.map((q) => q.author.name)})`);

// 4) Painel lateral
const panel = watch(await ctx.newPage(), "panel");
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
await panel.click("#back");

// Caixa de entrada: reabre o comentário (para testar o fluxo do painel), gera rascunhos e "Abrir e inserir"
await sw.evaluate(() => chrome.storage.local.get("queue").then(({ queue }) => {
  queue["c:urn:li:comment:(activity:99,1)"].status = "open"; return chrome.storage.local.set({ queue }); }));
await panel.click("nav >> text=Caixa de entrada");
await panel.waitForTimeout(300);
const qNames = await panel.$$eval(".qi header b", (els) => els.map((e) => e.textContent));
check(qNames.includes("Ana Costa") && qNames.includes("Paula Nunes"), `inbox: lista comentário e DM (${qNames})`);
const goalsTxt = await panel.textContent("#goals");
check(/Respostas/.test(goalsTxt) && /DMs/.test(goalsTxt), `inbox: metas do dia visíveis (${goalsTxt.replace(/\s+/g, " ").trim()})`);
const anaItem = '.qi[data-q="c:urn:li:comment:(activity:99,1)"]';
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
check(st.reply === 2 && st.like >= 3 && st.comment >= 2 && st.dm >= 2, `metas: contagem do dia (${JSON.stringify(st)})`);

await panel.click("nav >> text=Config");
check(await panel.isVisible("#serverForm"), "painel: aba Config abre");

check(errors.length === 0, `sem erros de JS (${errors.length})`);
errors.forEach((e) => console.log("   ", e));
await ctx.close();
process.exit(failed ? 1 : 0);

const S = NexoStore;
const $ = (s) => document.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const today = () => new Date().toISOString().slice(0, 10);
let tab = "inbox";
let qFilter = "";
const drafts = {}; // rascunhos gerados por item da fila (memória do painel)

const ask = (msg) => chrome.runtime.sendMessage(msg).then((r) => (r?.ok ? r.data : Promise.reject(new Error(r?.error || "Falha"))));
const avatar = (c) => c.avatar ? `<img src="${esc(c.avatar)}" alt="">` : `<span class="av">${esc((c.name || "?")[0])}</span>`;
const card = (c) => `<li class="card" draggable="true" data-id="${esc(c.id)}">${avatar(c)}<div><b>${esc(c.name)}</b><small>${esc(c.headline || "")}</small></div><span class="pill">${esc(c.stage)}</span></li>`;

$("#stageFilter").innerHTML = `<option value="">Todas etapas</option>` + S.STAGES.map((s) => `<option>${s}</option>`).join("");

document.querySelectorAll("nav button").forEach((b) => b.onclick = () => show(b.dataset.tab));
function show(t) {
  tab = t;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== t));
  render();
}

async function renderBanner() {
  const st = await S.getSettings();
  // Mostra enquanto for instalação nova sem chaves configuradas
  $("#restoreBanner").hidden = !(st.freshInstall && !st.anthropicKey && !st.session);
  if ($("#backupInfo")) $("#backupInfo").textContent = st.lastFileBackupAt ? `Última cópia automática: ${new Date(st.lastFileBackupAt).toLocaleString("pt-BR")}` : "";
}

async function render() {
  renderBanner();
  const { contacts, templates } = await S.get();
  const all = Object.values(contacts).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (tab === "contacts") {
    const q = $("#q").value.toLowerCase(), st = $("#stageFilter").value;
    const rows = all.filter((c) => (!st || c.stage === st) && [c.name, c.headline, c.company, ...(c.tags || [])].join(" ").toLowerCase().includes(q));
    $("#list").innerHTML = rows.map(card).join("") || `<p class="empty">Abra um perfil no LinkedIn e clique em “+ Salvar contato”.</p>`;
  }
  if (tab === "pipeline") {
    $("#board").innerHTML = S.STAGES.map((s) => {
      const cs = all.filter((c) => c.stage === s);
      return `<div class="col" data-stage="${s}"><h3>${s}<span>${cs.length}</span></h3><ul class="cards">${cs.map(card).join("")}</ul></div>`;
    }).join("");
    document.querySelectorAll(".col").forEach((col) => {
      col.ondragover = (e) => { e.preventDefault(); col.classList.add("over"); };
      col.ondragleave = () => col.classList.remove("over");
      col.ondrop = async (e) => {
        const id = e.dataTransfer.getData("text/plain");
        await S.patchContact(id, { stage: col.dataset.stage });
        await S.logActivity(id, "stage", `Movido para ${col.dataset.stage}`);
        render();
      };
    });
  }
  if (tab === "inbox") {
    await renderInbox();
    const due = all.filter((c) => c.followUp && c.followUp <= today()).sort((a, b) => a.followUp.localeCompare(b.followUp));
    $("#dueList").innerHTML = due.map(card).join("") || `<p class="empty">Nenhum follow-up para hoje.</p>`;
  }
  if (tab === "templates") {
    $("#tplList").innerHTML = templates.map((t) => `<li><b>${esc(t.name)}</b> <span class="pill">${t.kind === "dm" ? "DM" : "Comentário"}</span><p>${esc(t.body)}</p><button class="ghost" data-del="${esc(t.id)}">Remover</button></li>`).join("");
    document.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => { await S.saveTemplates(templates.filter((t) => t.id !== b.dataset.del)); render(); });
  }
  if (tab === "config") await renderConfig();
  document.querySelectorAll(".card").forEach((el) => {
    el.onclick = () => openDetail(el.dataset.id);
    el.ondragstart = (e) => e.dataTransfer.setData("text/plain", el.dataset.id);
  });
}

const GOAL_LABELS = { like: "Curtidas", comment: "Comentários", reply: "Respostas", dm: "DMs" };
async function renderInbox() {
  const st = await S.getSettings();
  const goals = { ...S.DEFAULT_GOALS, ...st.goals };
  const { today: t } = await S.getStats();
  $("#goals").innerHTML = Object.keys(GOAL_LABELS).map((k) => {
    const pct = goals[k] ? Math.min(100, Math.round((t[k] / goals[k]) * 100)) : 100;
    return `<div class="goal ${pct >= 100 ? "done" : ""}" title="Interações assistidas pelo Nexo hoje"><b>${t[k]}<small>/${goals[k]}</small></b><small>${GOAL_LABELS[k]}</small><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }).join("");

  const queue = Object.values(await S.getQueue()).filter((q) => q.status === "open" && (!qFilter || q.kind === qFilter))
    // Seus posts e suas DMs primeiro; dentro de cada grupo, os mais recentes
    .sort((a, b) => (a.priority || 2) - (b.priority || 2) || b.seenAt - a.seenAt);
  if (!queue.length) {
    $("#queue").innerHTML = `<p class="empty">${!st.me && !qFilter ? "Abra suas <b>Notificações → Meus posts</b> ou suas <b>Mensagens</b>: comentários e DMs aparecem aqui. Para monitorar também os posts abertos, clique em <b>⭐ Este sou eu</b> no seu perfil.<br><br>" : ""}${!st.me ? "Abra o <b>seu</b> perfil no LinkedIn e clique em <b>⭐ Este sou eu</b> para o Nexo monitorar comentários nos seus posts." :
      "Nada pendente. Abra seus posts, notificações ou mensagens: comentários sem resposta e DMs não lidas aparecem aqui."}</p>`;
    return;
  }
  // Rascunho vindo da triagem do Claude já entra como opção selecionada
  for (const q of queue) if (q.draft && (!drafts[q.id] || drafts[q.id].fromTriage !== q.draft) && !drafts[q.id]?.loading)
    drafts[q.id] = { list: [q.draft], pick: 0, text: q.draft, fromTriage: q.draft };
  const CLS = { lead: "Lead", recrutador: "Recrutador", parceria: "Parceria/venda", peer: "Peer", substancia: "Substância", apoio: "Apoio", ruido: "Ruído", spam: "Spam" };
  $("#queue").innerHTML = queue.map((q) => {
    const d = drafts[q.id];
    return `<li class="qi" data-q="${esc(q.id)}">
      <header><span>${q.kind === "dm" ? "✉️" : q.kind === "invite" ? "🤝" : "💬"}</span><b>${esc(q.author?.name || "?")}</b>
        ${CLS[q.classification] ? `<span class="cls cls-${esc(q.classification)}">${CLS[q.classification]}</span>` : ""}
        ${q.source === "claude-triage" ? `<span class="cls" title="Rascunho da tarefa agendada Triagem LinkedIn">Claude</span>` : ""}
        ${q.priority === 1 ? `<span class="prio">${q.kind === "dm" ? "Sua DM" : "Seu post"}</span>` : ""}
        <small>${new Date(q.seenAt).toLocaleDateString("pt-BR")}</small></header>
      ${q.author?.headline ? `<small>${esc(q.author.headline)}</small>` : ""}
      <blockquote>${esc(q.text)}</blockquote>
      ${q.why ? `<small>💡 ${esc(q.why)}</small>` : ""}
      ${d?.list ? `<div class="drafts">${d.list.map((x, i) => `<button data-pick="${i}" class="${d.pick === i ? "on" : ""}">${esc(x)}</button>`).join("")}</div>
        <textarea data-edit>${esc(d.text || "")}</textarea>` : ""}
      <div class="row">
        ${q.kind === "invite" ? "" : `<button data-act="gen">${d?.loading ? "Gerando…" : d?.list ? "✨ Gerar de novo" : "✨ Gerar respostas"}</button>`}
        <button data-act="open" class="ghost">${d?.text && q.kind !== "invite" ? "Abrir e inserir" : "Abrir"}</button>
        <button data-act="done" class="ghost">✔ Feito</button>
        <button data-act="skip" class="ghost">Ignorar</button>
      </div></li>`;
  }).join("");
  document.querySelectorAll(".qi").forEach((li) => {
    const q = queue.find((x) => x.id === li.dataset.q);
    const gen = li.querySelector('[data-act="gen"]');
    if (gen) gen.onclick = () => generateFor(q);
    li.querySelector('[data-act="open"]').onclick = () => openItem(q);
    li.querySelector('[data-act="done"]').onclick = () => S.setQueueStatus(q.id, "done").then(render);
    li.querySelector('[data-act="skip"]').onclick = () => S.setQueueStatus(q.id, "dismissed").then(render);
    li.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => { drafts[q.id].pick = +b.dataset.pick; drafts[q.id].text = drafts[q.id].list[+b.dataset.pick]; render(); });
    const ta = li.querySelector("[data-edit]");
    if (ta) ta.oninput = () => (drafts[q.id].text = ta.value);
  });
}

async function generateFor(q) {
  drafts[q.id] = { ...drafts[q.id], loading: true };
  render();
  try {
    const { contacts } = await S.get();
    const c = contacts[q.author?.id];
    const contact = c ? { name: c.name, headline: c.headline, company: c.company, stage: c.stage, notes: c.notes, about: c.about, interests: c.interests } : { name: q.author?.name };
    const list = q.kind === "comment"
      ? await ask({ type: "ai-suggest", kind: "comment-reply", context: { postText: q.postText, comment: { author: q.author?.name, text: q.text }, contact } })
      : await ask({ type: "ai-suggest", kind: "reply", context: { thread: [`${q.author?.name}: ${q.text}`], contact } });
    drafts[q.id] = { list, pick: 0, text: list[0] };
  } catch (e) {
    drafts[q.id] = {};
    alert(e.message);
  }
  render();
}

async function openItem(q) {
  const text = drafts[q.id]?.text?.trim();
  if (text && q.kind !== "invite") await S.setPending({ url: q.url, kind: q.kind, targetId: q.targetId, text, author: q.author?.name, text0: q.text });
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url?.startsWith("https://www.linkedin.com/")) await chrome.tabs.update(active.id, { url: q.url });
  else await chrome.tabs.create({ url: q.url });
}

async function openDetail(id) {
  const { contacts } = await S.get();
  const c = contacts[id]; if (!c) return;
  document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== "detail"));
  $("#detail").innerHTML = `
    <button class="ghost" id="back">← Voltar</button>
    <div class="card" style="margin:10px 0">${avatar(c)}<div><b>${esc(c.name)}</b><small>${esc(c.headline || "")}</small></div></div>
    <div class="kv">
      <div><span>E-mail:</span> ${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a> <small>(${esc(c.emailSource || "?")}${c.emailConfidence ? ` · confiança ${esc(c.emailConfidence)}` : ""})</small>` : "—"}</div>
      ${c.about ? `<div><span>Sobre:</span> ${esc(c.about)}</div>` : ""}
      ${(c.interests || []).length ? `<div><span>Temas:</span> ${c.interests.map(esc).join(" · ")}</div>` : ""}
      ${c.companyInfo ? `<div><span>Empresa:</span> ${esc(c.companyInfo.name || c.company || "")} ${c.companyInfo.domain ? `· ${esc(c.companyInfo.domain)}` : ""}</div>
      <div><span>Setor/porte:</span> ${esc(c.companyInfo.industry || "?")} · ${esc(c.companyInfo.employees || "?")} pessoas ${c.companyInfo.location ? `· ${esc(c.companyInfo.location)}` : ""}</div>
      ${c.companyInfo.description ? `<div><span>Empresa:</span> ${esc(c.companyInfo.description)}</div>` : ""}
      ${(c.companyInfo.sources || []).length ? `<div><span>Fontes:</span> ${c.companyInfo.sources.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname)}</a>`).join(", ")}</div>` : ""}` : ""}
      ${(c.websites || []).map((w) => `<div><a href="${esc(w)}" target="_blank" rel="noopener">${esc(w)}</a></div>`).join("")}
    </div>
    <div class="row"><button class="ghost" id="enrich">🔎 Enriquecer</button><button class="ghost" id="aiDm">✨ Sugerir DM</button></div>
    <div id="suggs"></div>
    <form id="df">
      <label>Etapa<select name="stage">${S.STAGES.map((s) => `<option ${s === c.stage ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>Empresa<input name="company" value="${esc(c.company || "")}"></label>
      <label>Tags (vírgula)<input name="tags" value="${esc((c.tags || []).join(", "))}"></label>
      <label>Próximo follow-up<input type="date" name="followUp" value="${esc(c.followUp || "")}"></label>
      <label>Notas<textarea name="notes" rows="4">${esc(c.notes || "")}</textarea></label>
      <button>Salvar</button>
    </form>
    <div class="row" style="margin-top:8px"><button class="ghost" id="openLi">Abrir no LinkedIn</button><button class="danger" id="del">Excluir</button></div>
    <h3>Histórico</h3>${(c.activities || []).map((a) => `<div class="act">${esc(a.text)} · ${new Date(a.at).toLocaleString("pt-BR")}</div>`).join("") || "<p class=empty>Sem atividades.</p>"}`;
  $("#back").onclick = () => show(tab);
  $("#enrich").onclick = async (e) => {
    e.target.textContent = "Buscando…";
    try { await ask({ type: "enrich", id }); openDetail(id); } catch (err) { alert(err.message); e.target.textContent = "🔎 Enriquecer"; }
  };
  $("#aiDm").onclick = async (e) => {
    e.target.textContent = "Gerando…";
    try {
      const list = await ask({ type: "ai-suggest", kind: "dm", context: { contact: { name: c.name, headline: c.headline, company: c.company, stage: c.stage, notes: c.notes, about: c.about, interests: c.interests } } });
      $("#suggs").innerHTML = list.map((t) => `<div class="sugg" title="Clique para copiar">${esc(t)}</div>`).join("");
      document.querySelectorAll(".sugg").forEach((el) => el.onclick = () => { navigator.clipboard.writeText(el.textContent); el.style.borderColor = "#2e9d5b"; });
    } catch (err) { alert(err.message); }
    e.target.textContent = "✨ Sugerir DM";
  };
  $("#openLi").onclick = () => chrome.tabs.create({ url: c.url });
  $("#del").onclick = async () => { if (confirm(`Excluir ${c.name}?`)) { await S.deleteContact(id); show(tab); } };
  $("#df").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const patch = { ...f, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), followUp: f.followUp || null };
    if (patch.stage !== c.stage) await S.logActivity(id, "stage", `Movido para ${patch.stage}`);
    await S.patchContact(id, patch);
    show(tab);
  };
}

const newToken = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function renderBridge(st) {
  const box = $("#bridgeBox");
  if (!st.bridgeToken) {
    box.innerHTML = `<p class="hint">Desativada. Ative para a tarefa agendada do Claude (Claude in Chrome) colocar rascunhos na sua Caixa de entrada.</p><button id="bridgeOn">Ativar e gerar token</button>`;
    $("#bridgeOn").onclick = async () => { await S.saveSettings({ bridgeToken: newToken() }); render(); };
    return;
  }
  const last = st.lastBridgeImport;
  box.innerHTML = `<div class="kv"><div><span>Status:</span> ativa ${last ? `· última importação ${new Date(last.at).toLocaleString("pt-BR")} (${last.accepted}/${last.received} itens)` : "· nenhuma importação ainda"}</div></div>
    <p class="hint">Cole este bloco no fim das instruções da tarefa <b>Triagem LinkedIn</b>. Ele contém seu token: não compartilhe.</p>
    <textarea id="bridgeSnippet" rows="10" readonly></textarea>
    <div class="row"><button id="copySnippet">Copiar instruções</button><button class="ghost" id="rotateToken">Novo token</button><button class="ghost" id="bridgeOff">Desativar</button></div>`;
  $("#bridgeSnippet").value = bridgeInstructions(st.bridgeToken);
  $("#copySnippet").onclick = (e) => { navigator.clipboard.writeText($("#bridgeSnippet").value); e.target.textContent = "Copiado ✔"; };
  $("#rotateToken").onclick = async () => {
    if (!confirm("O token atual deixa de funcionar. Atualize as instruções da tarefa depois. Continuar?")) return;
    await S.saveSettings({ bridgeToken: newToken() });
    render();
  };
  $("#bridgeOff").onclick = async () => { await S.saveSettings({ bridgeToken: null }); render(); };
}

function bridgeInstructions(token) {
  return `7. ENTREGA NO NEXO (depois do resumo): numa aba de https://www.linkedin.com/ use a ferramenta de JavaScript do Claude in Chrome para executar UMA vez:
window.postMessage({ type: "nexo:import", token: "${token}", items: [ ...itens da fila... ] }, "*")
Cada item: { kind: "dm" | "comment" | "invite", url: "<link do LinkedIn da conversa, do post (com ?commentUrn=... quando houver) ou do perfil>", author: { name, headline }, text: "<o que a pessoa escreveu, até 2000 caracteres>", classification: "lead" | "recrutador" | "parceria" | "peer" | "substancia" | "apoio" | "ruido" | "spam", urgency: 1 (urgente) | 2 | 3, why: "<1 linha do que pede>", draft: "<rascunho pronto>", postText: "<texto do post, só para comentários>" }.
Inclua só itens que pedem ação (não inclua os "sem ação"). Convites entram com kind "invite" e sem draft.
Confirme no resumo a resposta da página: ela publica { type: "nexo:import:result", accepted, rejected }. Se não houver resposta, diga "Nexo não respondeu (extensão desativada ou token errado)". Isso NÃO envia nada no LinkedIn: só deixa os rascunhos na Caixa de entrada do Nexo para o Julio revisar.`;
}

// Backup local completo (contatos, templates, fila, metas, configurações e chaves): útil ao reinstalar a extensão
$("#backupExport").onclick = async () => {
  const all = await chrome.storage.local.get(null);
  delete all.pendingInsert;
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([JSON.stringify({ nexoBackup: 1, at: new Date().toISOString(), data: all }, null, 2)], { type: "application/json" })),
    download: `nexo-backup-${new Date().toISOString().slice(0, 10)}.json`
  });
  a.click();
};
async function restoreFromFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const b = JSON.parse(await file.text());
    if (b.nexoBackup !== 1 || typeof b.data !== "object") throw new Error("Arquivo não é um backup do Nexo.");
    if (!confirm(`Restaurar o backup de ${new Date(b.at).toLocaleString("pt-BR")}? Os dados atuais desta extensão serão substituídos.`)) return;
    await chrome.storage.local.clear();
    await chrome.storage.local.set(b.data);
    await S.saveSettings({ freshInstall: false, restoredFrom: "arquivo" });
    alert("Dados restaurados ✔");
    render();
  } catch (err) { alert(err.message); }
  e.target.value = "";
}
$("#backupImport").onchange = restoreFromFile;
$("#restoreFile").onchange = restoreFromFile;
$("#restoreSkip").onclick = () => S.saveSettings({ freshInstall: false }).then(render);
$("#restoreLogin").onclick = () => { S.saveSettings({ freshInstall: false }); show("config"); };

async function renderConfig() {
  const st = await S.getSettings();
  await renderBridge(st);
  const goals = { ...S.DEFAULT_GOALS, ...st.goals };
  for (const el of $("#goalsForm").elements) if (el.name && document.activeElement !== el) el.value = goals[el.name];
  $("#meInfo").innerHTML = st.me ? `Seu perfil: <b>${esc(st.me.name)}</b>. Comentários nos seus posts entram na Caixa de entrada.`
    : "Abra seu perfil no LinkedIn e clique em ⭐ Este sou eu para ativar o monitoramento de comentários.";
  for (const f of ["#aiForm", "#serverForm", "#exaForm"]) {
    for (const el of $(f).elements) if (el.name && document.activeElement !== el) el.value = st[el.name] || (el.tagName === "SELECT" ? el.options[0].value : "");
  }
  const box = $("#teamBox");
  if (!st.serverUrl) { box.innerHTML = `<p class="hint">Informe o endereço do seu servidor Nexo para usar em equipe.</p>`; return; }
  if (!st.session) {
    // Duas abas explícitas: Enter sempre executa a ação da aba visível (antes, Enter disparava "Entrar")
    const mode = box.dataset.mode || "register";
    box.innerHTML = `<button id="googleBtn" class="google"><svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>Entrar com Google</button>
      <details><summary>Tenho um código de convite</summary><input id="googleInvite" placeholder="Código de convite (só para contas não autorizadas)"></details>
      <p class="hint">ou com e-mail e senha:</p>
      <div class="row seg" id="authMode">
        <button type="button" data-m="register" class="${mode === "register" ? "on" : ""}">Criar conta</button>
        <button type="button" data-m="login" class="${mode === "login" ? "on" : ""}">Já tenho conta</button></div>
      <form id="authForm">
        <label>E-mail<input name="email" type="email" required autocomplete="username"></label>
        <label>Senha${mode === "register" ? " (nova, mín. 10 caracteres)" : ""}<input name="password" type="password" required minlength="10" autocomplete="${mode === "register" ? "new-password" : "current-password"}"></label>
        ${mode === "register" ? `
        <label>Código de cadastro do servidor (fundadores)<input name="signupCode" type="password" autocomplete="off"></label>
        <label>…ou código de convite de uma equipe<input name="inviteCode" autocomplete="off"></label>
        <p class="hint">Preencha um dos dois códigos.</p>` : ""}
        <button>${mode === "register" ? "Criar conta" : "Entrar"}</button>
      </form>`;
    $("#googleBtn").onclick = () => run(ask({ type: "login-google", inviteCode: ($("#googleInvite").value || "").trim() }));
    box.querySelectorAll("#authMode button").forEach((b) => b.onclick = () => { box.dataset.mode = b.dataset.m; render(); });
    $("#authForm").onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (mode === "register" && !f.signupCode.trim() && !f.inviteCode.trim()) return alert("Informe o código de cadastro ou um código de convite.");
      run(ask(mode === "register"
        ? { type: "register", email: f.email, password: f.password, inviteCode: f.inviteCode.trim(), signupCode: f.signupCode.trim() }
        : { type: "login", email: f.email, password: f.password }));
    };
    return;
  }
  const teams = await ask({ type: "list-teams" }).catch(() => []);
  const picker = teams.length > 1 ? `<label>Equipe ativa<select id="teamPick">${teams.map((t) => `<option value="${esc(t.id)}" ${t.id === st.teamId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>` : "";
  const joinForms = `<form id="newTeam"><input name="name" placeholder="Nome da nova equipe" required><button>Criar equipe</button></form>
      <form id="joinTeam"><input name="code" placeholder="Código de convite" required><button>Entrar em equipe</button></form>`;
  if (!st.teamId) {
    box.innerHTML = `<p>Conectado como <b>${esc(st.session.email)}</b></p>${picker}${joinForms}<button class="ghost" id="logout">Sair</button>`;
  } else {
    const info = await ask({ type: "team-info" }).catch(() => null);
    box.innerHTML = `${picker}<div class="kv"><div><span>Equipe:</span> <b>${esc(st.teamName || "")}</b></div>
      <div><span>Convite:</span> <code>${esc(st.inviteCode || "")}</code> <small>(compartilhe só com sua equipe)</small></div>
      <div><span>Conta:</span> ${esc(st.session.email)}</div>
      ${info ? `<div><span>Membros:</span> ${info.members.map((m) => esc(m.email) + (m.role === "owner" ? " 👑" : "")).join(", ")}</div>` : ""}</div>
      <div class="row"><button id="syncBtn">Sincronizar agora</button>${st.teamRole === "owner" ? `<button class="ghost" id="rotate">Novo convite</button>` : ""}<button class="ghost" id="logout">Sair</button></div>
      <details><summary>Outra equipe</summary>${joinForms}</details>`;
    $("#syncBtn").onclick = () => run(ask({ type: "sync-now" }).then((r) => alert(`Recebidos: ${r.pulled} · Enviados: ${r.pushed}`)));
    if ($("#rotate")) $("#rotate").onclick = () => confirm("O convite atual deixará de funcionar. Continuar?") && run(ask({ type: "rotate-invite" }));
  }
  $("#newTeam").onsubmit = (e) => { e.preventDefault(); run(ask({ type: "create-team", name: e.target.name.value })); };
  $("#joinTeam").onsubmit = (e) => { e.preventDefault(); run(ask({ type: "join-team", code: e.target.code.value.trim() })); };
  $("#logout").onclick = () => run(ask({ type: "logout" }));
  if ($("#teamPick")) $("#teamPick").onchange = (e) => run(ask({ type: "switch-team", id: e.target.value }));
}
const run = (p) => p.then((r) => { if (r?.restored) alert("Suas configurações foram restauradas do servidor ✔"); })
  .catch((e) => alert(e.message)).finally(render);
const saveForm = (sel) => $(sel).onsubmit = async (e) => {
  e.preventDefault();
  await S.saveSettings(Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, v.trim()])));
  e.submitter.textContent = "Salvo ✔";
  setTimeout(() => render(), 900);
};
["#aiForm", "#exaForm"].forEach(saveForm);

// O servidor é escolhido pelo usuário: a permissão de rede é pedida só para aquela origem.
$("#serverForm").onsubmit = async (e) => {
  e.preventDefault();
  let url;
  try { url = new URL(e.target.serverUrl.value.trim()); } catch { return alert("Endereço inválido."); }
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) return alert("Use HTTPS (exceto localhost).");
  const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
  if (!granted) return alert("Sem a permissão o Nexo não consegue falar com o servidor.");
  const st = await S.getSettings();
  if (st.serverUrl && st.serverUrl !== url.origin) await ask({ type: "logout" }).catch(() => {});
  await S.saveSettings({ serverUrl: url.origin });
  e.submitter.textContent = "Salvo ✔";
  setTimeout(render, 900);
};

async function renderSyncStatus() {
  const st = await S.getSettings();
  $("#syncStatus").textContent = !st.teamId ? "Modo local (sem equipe)"
    : st.lastSyncError ? `⚠️ Sync: ${st.lastSyncError}`
    : `☁️ ${st.teamName} · sincronizado ${st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleTimeString("pt-BR") : "—"}`;
}

document.querySelectorAll("#qfilter button").forEach((b) => b.onclick = () => {
  qFilter = b.dataset.f;
  document.querySelectorAll("#qfilter button").forEach((x) => x.classList.toggle("on", x === b));
  render();
});
$("#goalsForm").onsubmit = async (e) => {
  e.preventDefault();
  const goals = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, Math.max(0, +v || 0)]));
  await S.saveSettings({ goals });
  e.submitter.textContent = "Salvo ✔";
  setTimeout(render, 900);
};

$("#diagnose").onclick = async () => {
  const out = $("#diagOut");
  out.hidden = false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith("https://www.linkedin.com/")) { out.textContent = "Abra uma aba do LinkedIn e clique de novo."; return; }
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: "nexo:diagnose" });
    const c = r.counts;
    const hints = [];
    if (r.path.startsWith("/notifications") && !c.notifCandidates) hints.push("Nenhum card de notificação reconhecido. Copie este relatório e envie.");
    if (c.notifCandidates && !c.notifParsed) hints.push("Cards encontrados, mas sem texto de comentário legível. Copie este relatório e envie.");
    if (c.notifParsed) hints.push(`${c.notifParsed} comentário(s) reconhecido(s): veja a Caixa de entrada.`);
    if (!r.me) hints.push("Perfil não definido: abra seu perfil e clique em ⭐ Este sou eu (necessário para posts abertos).");
    out.textContent = `Nexo ${r.version} ativo nesta aba ✔\n${hints.join("\n")}\n\n${JSON.stringify(r, null, 1)}`;
  } catch {
    out.textContent = "O Nexo NÃO está ativo nesta aba.\nRecarregue a página do LinkedIn (F5): abas abertas antes de instalar/atualizar a extensão ficam sem o Nexo.";
  }
  out.onclick = () => navigator.clipboard.writeText(out.textContent);
  out.title = "Clique para copiar";
};

$("#q").oninput = render;
$("#stageFilter").onchange = render;
$("#tplForm").onsubmit = async (e) => {
  e.preventDefault();
  const { templates } = await S.get();
  await S.saveTemplates([...templates, { id: "t" + Date.now(), ...Object.fromEntries(new FormData(e.target)) }]);
  e.target.reset(); render();
};
$("#export").onclick = async () => {
  const { contacts } = await S.get();
  const cols = ["name", "headline", "company", "stage", "tags", "followUp", "notes", "url"];
  const q = (v) => `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...Object.values(contacts).map((c) => cols.map((k) => q(c[k])).join(","))].join("\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })), download: "nexo-contatos.csv" });
  a.click();
};
chrome.storage.onChanged.addListener((ch) => {
  if (ch.settings) renderSyncStatus();
  if (!$("#detail").hidden || (tab === "config" && !ch.settings)) return;
  // Na caixa de entrada, não redesenha enquanto o usuário edita um rascunho
  if (tab === "inbox" && document.activeElement?.matches?.("[data-edit]")) return;
  render();
});
renderSyncStatus();
render();

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

async function render() {
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
  $("#queue").innerHTML = queue.map((q) => {
    const d = drafts[q.id];
    return `<li class="qi" data-q="${esc(q.id)}">
      <header><span>${q.kind === "dm" ? "✉️" : "💬"}</span><b>${esc(q.author?.name || "?")}</b>
        ${q.priority === 1 ? `<span class="prio">${q.kind === "dm" ? "Sua DM" : "Seu post"}</span>` : ""}
        <small>${new Date(q.seenAt).toLocaleDateString("pt-BR")}</small></header>
      <blockquote>${esc(q.text)}</blockquote>
      ${d?.list ? `<div class="drafts">${d.list.map((x, i) => `<button data-pick="${i}" class="${d.pick === i ? "on" : ""}">${esc(x)}</button>`).join("")}</div>
        <textarea data-edit>${esc(d.text || "")}</textarea>` : ""}
      <div class="row">
        <button data-act="gen">${d?.loading ? "Gerando…" : d?.list ? "✨ Gerar de novo" : "✨ Gerar respostas"}</button>
        <button data-act="open" class="ghost">${d?.text ? "Abrir e inserir" : "Abrir"}</button>
        <button data-act="done" class="ghost">✔ Feito</button>
        <button data-act="skip" class="ghost">Ignorar</button>
      </div></li>`;
  }).join("");
  document.querySelectorAll(".qi").forEach((li) => {
    const q = queue.find((x) => x.id === li.dataset.q);
    li.querySelector('[data-act="gen"]').onclick = () => generateFor(q);
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
  if (text) await S.setPending({ url: q.url, kind: q.kind, targetId: q.targetId, text, author: q.author?.name, text0: q.text });
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

async function renderConfig() {
  const st = await S.getSettings();
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
    box.innerHTML = `<form id="authForm">
        <label>E-mail<input name="email" type="email" required autocomplete="username"></label>
        <label>Senha (mín. 10 caracteres)<input name="password" type="password" required minlength="10" autocomplete="current-password"></label>
        <div class="row"><button name="mode" value="login">Entrar</button></div>
        <details><summary>Criar conta</summary>
          <label>Código de convite da equipe<input name="inviteCode"></label>
          <label>…ou código de cadastro do servidor (fundadores)<input name="signupCode" type="password" autocomplete="off"></label>
          <button name="mode" value="register" class="ghost">Criar conta</button>
        </details></form>`;
    $("#authForm").onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      run(ask(e.submitter.value === "register"
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
const run = (p) => p.catch((e) => alert(e.message)).finally(render);
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

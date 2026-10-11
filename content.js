// Nexo content script — tudo é disparado por clique do usuário. Nada é enviado automaticamente:
// o Nexo preenche o texto, você revisa e aperta "Enviar". Isso mantém sua conta segura.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const text = (sel, root) => ($(sel, root)?.innerText || "").trim();

  function toast(msg) {
    const t = Object.assign(document.createElement("div"), { className: "nexo-toast", textContent: msg });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  function insertInto(editor, value, { append = false } = {}) {
    editor.focus();
    if (append) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const existing = editor.innerText.trim();
      document.execCommand("insertText", false, existing ? ` ${value}` : value);
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, value);
    }
  }

  // Menu flutuante genérico: items = [{ label, title, value }]
  function showMenu(anchor, items, onPick, emptyText) {
    document.querySelector(".nexo-menu")?.remove();
    const menu = Object.assign(document.createElement("div"), { className: "nexo-menu" });
    items.forEach((it) => {
      const b = Object.assign(document.createElement("button"), { textContent: it.label, title: it.title || "" });
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); menu.remove(); onPick(it.value); };
      menu.appendChild(b);
    });
    if (!items.length) menu.textContent = emptyText || "Nada por aqui";
    const r = anchor.getBoundingClientRect();
    Object.assign(menu.style, { top: `${r.bottom + window.scrollY + 4}px`, left: `${r.left + window.scrollX}px` });
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", (e) => { if (!menu.contains(e.target)) menu.remove(); }, { once: true }), 0);
    return menu;
  }

  async function pickTemplate(anchor, kind, contact, onPick) {
    const { templates } = await NexoStore.get();
    showMenu(anchor, templates.filter((t) => t.kind === kind).map((t) => ({ label: t.name, title: t.body, value: NexoStore.fill(t.body, contact) })),
      onPick, "Crie templates no painel do Nexo");
  }

  const ask = (msg) => chrome.runtime.sendMessage(msg).then((r) => (r?.ok ? r.data : Promise.reject(new Error(r?.error || "Falha na extensão"))));

  // Sugestões da IA: mostra estado de carregamento no próprio menu, depois as 3 alternativas
  async function pickAI(anchor, kind, context, onPick) {
    const loading = showMenu(anchor, [], () => {}, "✨ Gerando sugestões…");
    try {
      const list = await ask({ type: "ai-suggest", kind, context });
      loading.remove();
      showMenu(anchor, list.map((t) => ({ label: t.length > 90 ? t.slice(0, 90) + "…" : t, title: t, value: t })), onPick, "Sem sugestões");
    } catch (e) {
      loading.remove();
      toast(e.message);
    }
  }

  function chip(label, onClick) {
    const b = Object.assign(document.createElement("button"), { className: "nexo-chip", textContent: label, type: "button" });
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    return b;
  }

  // 1) Página de perfil: salvar no CRM
  function scrapeProfile() {
    const id = NexoStore.idFromUrl(location.href);
    if (!id) return null;
    const main = $("main") || document;
    const name = text("h1", main);
    if (!name) return null;
    const headline = text(".text-body-medium", main);
    return {
      id, name, headline,
      location: text(".text-body-small.inline", main),
      company: text('button[aria-label*="Empresa atual"], button[aria-label*="Current company"]', main),
      avatar: $("img.pv-top-card-profile-picture__image--show, img.pv-top-card-profile-picture__image", main)?.src,
      url: `https://www.linkedin.com/in/${id}/`
    };
  }

  async function renderProfileBar() {
    const p = scrapeProfile();
    let bar = $("#nexo-profile-bar");
    if (!p) return bar?.remove();
    if (bar?.dataset.id === p.id) return;
    bar?.remove();
    const { contacts } = await NexoStore.get();
    bar = Object.assign(document.createElement("div"), { id: "nexo-profile-bar" });
    bar.dataset.id = p.id;
    const saved = contacts[p.id];
    const label = document.createElement("span");
    label.textContent = saved ? `No Nexo · ${saved.stage}` : "Não está no Nexo";
    bar.append(
      Object.assign(document.createElement("strong"), { textContent: "Nexo" }), label,
      chip(saved ? "Atualizar" : "+ Salvar contato", async () => {
        const c = await NexoStore.upsertContact(p);
        if (!saved) await NexoStore.logActivity(c.id, "saved", "Contato salvo a partir do perfil");
        label.textContent = `No Nexo · ${c.stage}`;
        toast(`${c.name} salvo no Nexo ✔`);
      }),
      ...((await NexoStore.getSettings()).me?.id === p.id ? [] : [chip("⭐ Este sou eu", async (b) => {
        await NexoStore.saveSettings({ me: { id: p.id, name: p.name, headline: p.headline } });
        b.remove();
        toast("Perfil definido: o Nexo vai monitorar comentários nos seus posts ✔");
      })]),
      chip("🔎 Enriquecer", async () => {
        await NexoStore.upsertContact(p);
        try {
          const r = await ask({ type: "enrich", id: p.id });
          toast(r.found ? (r.contact.email ? `E-mail público: ${r.contact.email}` : "Perfil e empresa enriquecidos ✔") : "A Exa não encontrou dados confiáveis");
        } catch (e) { toast(e.message); }
      }),
      chip("Abrir painel", () => chrome.runtime.sendMessage({ type: "open-panel" }))
    );
    document.body.appendChild(bar);
  }

  // Seletores com fallback: classes do LinkedIn mudam com frequência, atributos de acessibilidade mudam menos.
  const SEL = {
    like: 'button[aria-label*="React Like"], button[aria-label*="Gostei"], button[aria-label*="Reagir"], button[aria-label*="Like"], button.react-button__trigger',
    comment: 'button[aria-label*="Comment"], button[aria-label*="Comentar"], button[aria-label*="comentário"]',
    editor: ".comments-comment-box .ql-editor, .comments-comment-texteditor [contenteditable='true'], [contenteditable='true'][role='textbox'], [contenteditable='true']",
    postText: ".update-components-text, .feed-shared-update-v2__description, .feed-shared-inline-show-more-text, [data-test-id='main-feed-activity-card__commentary'], .break-words"
  };

  // 2) Feed: ações por post (salvar autor, curtir+registrar, rascunho de comentário)
  function postAuthor(post) {
    const a = post.querySelector('.update-components-actor__meta-link, a.update-components-actor__image, a[href*="/in/"]');
    const id = NexoStore.idFromUrl(a?.href);
    if (!id) return null;
    // Fallback: primeira linha de texto do link do autor (interfaces sem as classes antigas)
    const name = (text(".update-components-actor__title span[aria-hidden='true']", post) || text(".update-components-actor__title", post)
      || [...post.querySelectorAll(`a[href*="/in/${id}"]`)].map((x) => x.innerText.trim()).find(Boolean) || "").split("\n")[0].trim();
    const headline = text(".update-components-actor__description span[aria-hidden='true']", post)
      || ((a.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean)[1] || "");
    return { id, name, headline, url: `https://www.linkedin.com/in/${id}/` };
  }

  function enhancePost(post) {
    if (post.dataset.nexo) return;
    post.dataset.nexo = "1";
    const actions = post.querySelector(".feed-shared-social-action-bar, .social-details-social-actions")
      || post.querySelector(SEL.like)?.parentElement;
    if (!actions) { delete post.dataset.nexo; return; } // ainda carregando: tenta no próximo scan
    const bar = Object.assign(document.createElement("div"), { className: "nexo-post-bar" });
    bar.append(
      chip("＋ Autor no CRM", async () => {
        const a = postAuthor(post);
        if (!a) return toast("Autor não é um perfil pessoal");
        await NexoStore.upsertContact(a);
        await NexoStore.logActivity(a.id, "saved", "Salvo a partir de um post");
        toast(`${a.name} salvo ✔`);
      }),
      chip("👍 Curtir", async () => {
        const like = post.querySelector(SEL.like);
        if (!like) return toast("Botão de curtir não encontrado");
        if (like.getAttribute("aria-pressed") !== "true") { like.click(); NexoStore.bumpStat("like"); }
        const a = postAuthor(post);
        if (a) await NexoStore.logActivity(a.id, "like", "Curtiu um post");
        toast("Curtido e registrado ✔");
      }),
      chip("💬 Comentar com template", async (btn) => {
        const a = postAuthor(post) || {};
        post.querySelector(SEL.comment)?.click();
        pickTemplate(btn, "comment", a, async (value) => {
          const editor = await waitFor(() => post.querySelector(SEL.editor));
          if (!editor) return toast("Abra a caixa de comentário");
          insertInto(editor, value);
          NexoStore.bumpStat("comment");
          if (a.id) await NexoStore.logActivity(a.id, "comment", "Rascunho de comentário inserido");
        });
      }),
      chip("✨ Comentar com IA", async (btn) => {
        const a = postAuthor(post) || {};
        const postText = text(SEL.postText, post).slice(0, 4000);
        if (!postText) return toast("Post sem texto para analisar");
        const { contacts } = await NexoStore.get();
        pickAI(btn, "comment", { postText, author: a.name, contact: slim(contacts[a.id]) }, async (value) => {
          post.querySelector(SEL.comment)?.click();
          const editor = await waitFor(() => post.querySelector(SEL.editor));
          if (!editor) return toast("Abra a caixa de comentário");
          insertInto(editor, value);
          NexoStore.bumpStat("comment");
          if (a.id) await NexoStore.logActivity(a.id, "comment", "Comentário sugerido por IA inserido");
        });
      })
    );
    actions.after(bar);
  }

  // 2b) Comentários: responder com IA, curtir, e alimentar a fila de engajamento
  const COMMENT = "article.comments-comment-entity, article.comments-comment-item, [data-id^='urn:li:comment']";
  const ownLevel = (root, sel) => [...root.querySelectorAll(sel)].filter((x) => x.closest(COMMENT) === root);
  // "urn:li:comment:(activity:7380,7381)" e "urn:li:comment:(urn:li:activity:7380,7381)" → "7380:7381"
  const commentKey = (s) => { const m = /activity:(\d+)\s*,\s*(\d+)/.exec(decodeURIComponent(s || "")); return m ? `${m[1]}:${m[2]}` : s; };
  const hashId = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return `h${(h >>> 0).toString(36)}`; };

  function commentInfo(el) {
    const a = ownLevel(el, 'a[href*="/in/"]')[0];
    const authorId = NexoStore.idFromUrl(a?.href);
    const name = (text(".comments-comment-meta__description-title, .comments-post-meta__name-text", el)
      || ownLevel(el, 'a[href*="/in/"]').map((x) => x.innerText.trim()).find(Boolean) || "").split("\n")[0].trim();
    const body = ownLevel(el, ".comments-comment-item__main-content, .comments-comment-entity__content, .update-components-text, .break-words")[0];
    const txt = (body?.innerText || "").trim().slice(0, 2000);
    const id = el.getAttribute("data-id") ? commentKey(el.getAttribute("data-id")) : hashId(`${authorId}|${txt}`);
    return { id, author: { id: authorId, name }, text: txt };
  }

  function postUrlOf(post) {
    if (/\/feed\/update\//.test(location.pathname)) return location.origin + location.pathname;
    const urn = post?.getAttribute("data-urn") || post?.getAttribute("data-id");
    return urn ? `https://www.linkedin.com/feed/update/${urn}/` : location.href;
  }

  async function replyToComment(el, value) {
    ownLevel(el, 'button[aria-label*="Reply"], button[aria-label*="Responder"], button[aria-label*="responder"]')[0]?.click();
    const editor = await waitFor(() => [...el.querySelectorAll(SEL.editor)].find((e) => e.isContentEditable));
    if (!editor) { toast("Clique em Responder no comentário e tente de novo"); return false; }
    insertInto(editor, value, { append: true });
    const info = commentInfo(el);
    NexoStore.bumpStat("reply");
    await NexoStore.setQueueStatus(`c:${info.id}`, "done");
    const { contacts } = await NexoStore.get();
    if (info.author.id && contacts[info.author.id]) await NexoStore.logActivity(info.author.id, "reply", "Resposta a comentário inserida");
    return true;
  }

  function enhanceComment(el) {
    if (el.dataset.nexo) return;
    const replyBtn = ownLevel(el, 'button[aria-label*="Reply"], button[aria-label*="Responder"], button[aria-label*="responder"]')[0];
    if (!replyBtn) return; // ainda carregando
    el.dataset.nexo = "1";
    const bar = Object.assign(document.createElement("span"), { className: "nexo-comment-bar" });
    bar.append(
      chip("✨ Responder com IA", async (btn) => {
        const info = commentInfo(el);
        const post = el.closest("[data-nexo-post]") || document;
        const { contacts } = await NexoStore.get();
        pickAI(btn, "comment-reply", {
          postText: text(SEL.postText, post).slice(0, 3000),
          comment: { author: info.author.name, text: info.text },
          contact: slim(contacts[info.author.id]) || { name: info.author.name }
        }, (value) => replyToComment(el, value));
      }),
      chip("👍", () => {
        const like = ownLevel(el, SEL.like)[0];
        if (!like) return toast("Botão de curtir não encontrado");
        if (like.getAttribute("aria-pressed") !== "true") { like.click(); NexoStore.bumpStat("like"); toast("Comentário curtido ✔"); }
      })
    );
    replyBtn.parentElement.append(bar);
  }

  // Comentários sem resposta sua, nos SEUS posts, entram na fila do painel
  async function scanCommentsQueue() {
    const { me } = await NexoStore.getSettings();
    if (!me?.id) return;
    const items = [], answered = [];
    document.querySelectorAll("[data-nexo-post]").forEach((post) => {
      if (postAuthor(post)?.id !== me.id) return;
      const postText = text(SEL.postText, post).slice(0, 3000);
      [...post.querySelectorAll(COMMENT)].filter((c) => !c.parentElement.closest(COMMENT)).forEach((c) => {
        const info = commentInfo(c);
        if (!info.author.id || info.author.id === me.id || !info.text) return;
        const repliedByMe = [...c.querySelectorAll(COMMENT)].some((r) => r !== c && commentInfo(r).author.id === me.id);
        if (repliedByMe) return answered.push(`c:${info.id}`);
        items.push({ id: `c:${info.id}`, kind: "comment", url: postUrlOf(post), targetId: info.id, author: info.author, text: info.text, postText, priority: 1 });
      });
    });
    if (items.length) await NexoStore.enqueue(items);
    for (const id of answered) await NexoStore.setQueueStatus(id, "done");
  }

  // Notificações: "X commented on your post", "X replied to your comment", "X mentioned you…"
  const NOTIF_RE = /^(.+?)\s+(commented on|replied to|mentioned you|comentou|respondeu|mencionou)/i;
  const NOTIF_VERB = /\b(commented on|replied to|mentioned you|comentou|respondeu|mencionou)\b/i;
  const CARD_SEL = "article, li, [data-urn], .nt-card, [data-finite-scroll-hotkey-item]";
  const POST_LINK = 'a[href*="/feed/update/"], a[href*="/posts/"], a[href*="commentUrn"], a[href*="/comment/"]';

  // Cards candidatos a partir do TEXTO ("X commented on your post"), não de uma classe ou link específico
  function notificationCandidates() {
    const root = document.querySelector("main") || document.body;
    const cards = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (NOTIF_VERB.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let card = n.parentElement.closest(CARD_SEL);
      if (!card) { // sem tag de item: sobe até um ancestral que tenha um link de post
        card = n.parentElement;
        for (let i = 0; i < 8 && card.parentElement && card.parentElement !== root && !card.querySelector(POST_LINK); i++) card = card.parentElement;
      }
      if (card && !card.closest("[data-nexo-ui]")) cards.add(card);
    }
    return [...cards];
  }

  function notificationCards() {
    if (!location.pathname.startsWith("/notifications")) return [];
    return notificationCandidates().map((card) => {
      const lines = card.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
      const hi = lines.findIndex((l) => NOTIF_RE.test(l));
      if (hi < 0) return null;
      const a = card.querySelector(POST_LINK) || [...card.querySelectorAll("a[href]")].find((x) => !/\/in\//.test(x.getAttribute("href")));
      const m = NOTIF_RE.exec(lines[hi]);
      const author = m[1].replace(/\s+and \d+ others?$|\s+e (?:mais )?\d+ (?:outras? pessoas?|outros?)$/i, "").trim();
      const href = new URL(a ? a.getAttribute("href") : location.href, location.origin);
      const cUrn = href.searchParams.get("commentUrn") || href.searchParams.get("replyUrn") || "";
      const isMention = /mention|mencion/i.test(m[2]);
      // "commented on your post" / "comentou na sua publicação" = SEU post → prioridade máxima
      const onMyPost = /your post|sua publica|seu post/i.test(lines[hi]);
      // linhas depois do título: [comentário, texto do post, "N reactions • N comments", "20h"]
      // ignora: contadores, tempo, título repetido (texto para leitor de tela), "View profile", botões do Nexo
      const rest = lines.slice(hi + 1).filter((l) => l !== lines[hi] && !NOTIF_RE.test(l)
        && !/^\d+\s*(reactions?|reações?|comments?|comentários?)|^\d+[smhdw]$|^\d+\s*(min|h|d|sem|w)\b|^(view|ver)\s|^(status is|unread|não lida)|responder com ia/i.test(l));
      const commentText = isMention ? (rest[0] || "") : (rest.length > 1 ? rest[0] : "");
      const postText = isMention ? "" : (rest.length > 1 ? rest.slice(1).join(" ") : rest[0] || "");
      return {
        card, cUrn,
        item: {
          id: cUrn ? `c:${commentKey(cUrn)}` : `n:${hashId(`${author}|${commentText}|${href.pathname}`)}`,
          kind: "comment", url: href.origin + href.pathname + (cUrn ? `?commentUrn=${encodeURIComponent(cUrn)}` : ""),
          targetId: cUrn ? commentKey(cUrn) : null, author: { name: author }, text: commentText.slice(0, 2000), postText: postText.slice(0, 3000),
          source: "notification", priority: onMyPost ? 1 : 2
        }
      };
    }).filter((x) => x && x.item.text);
  }

  async function scanNotifications() {
    const found = notificationCards();
    if (!found.length) return;
    await NexoStore.enqueue(found.map((f) => f.item));
    for (const { card, item } of found) {
      if (card.dataset.nexo) continue;
      card.dataset.nexo = "1";
      const bar = Object.assign(document.createElement("div"), { className: "nexo-post-bar" });
      bar.dataset.nexoUi = "1";
      bar.append(chip("✨ Responder com IA", (btn) => pickAI(btn, "comment-reply",
        { postText: item.postText, comment: { author: item.author.name, text: item.text }, contact: { name: item.author.name } },
        async (value) => {
          await NexoStore.setPending({ url: item.url, kind: "comment", targetId: item.targetId, text: value, author: item.author.name, text0: item.text });
          location.href = item.url;
        })));
      card.append(bar);
    }
  }

  // DMs não lidas na lista de conversas entram na fila
  const threadKey = () => `dm:${(/\/messaging\/thread\/[^/]+/.exec(location.pathname) || [""])[0]}`;
  async function scanInboxQueue() {
    if (!location.pathname.startsWith("/messaging")) return;
    const items = [];
    document.querySelectorAll('a[href*="/messaging/thread/"]').forEach((a) => {
      const li = a.closest("li") || a;
      const unread = li.querySelector(".msg-conversation-card__unread-count, .notification-badge--show, [class*='unread']")
        || /não lida|unread/i.test(li.getAttribute("aria-label") || a.getAttribute("aria-label") || "");
      if (!unread) return;
      const path = (/\/messaging\/thread\/[^/?#]+/.exec(a.getAttribute("href")) || [])[0];
      if (!path) return;
      const lines = li.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
      const name = text(".msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names", li) || lines[0] || "";
      const snippet = text(".msg-conversation-card__message-snippet, .msg-conversation-card__message-snippet-body", li) || lines.at(-1) || "";
      items.push({ id: `dm:${path}`, kind: "dm", url: `https://www.linkedin.com${path}/`, author: { name }, text: snippet.slice(0, 500), priority: 1 });
    });
    if (items.length) await NexoStore.enqueue(items);
  }

  // "Abrir e inserir" vindo do painel: quando o alvo aparecer na página, insere o rascunho
  let pendingBusy = false;
  async function handlePending() {
    if (pendingBusy) return;
    const p = await NexoStore.takePending();
    const samePath = (u) => { try { return new URL(u).pathname.replace(/\/$/, "") === location.pathname.replace(/\/$/, ""); } catch { return false; } };
    if (!p || !samePath(p.url)) return;
    pendingBusy = true;
    try {
      if (p.kind === "comment") {
        const all = [...document.querySelectorAll(COMMENT)];
        const norm = (t) => (t || "").replace(/\s+/g, " ").trim().slice(0, 60);
        const el = all.find((c) => commentInfo(c).id === p.targetId)
          || all.find((c) => { const i = commentInfo(c); return p.author && i.author.name === p.author && (!p.text0 || norm(i.text) === norm(p.text0)); });
        if (!el) return; // ainda não carregou: tenta no próximo scan
        el.scrollIntoView({ block: "center" });
        if (await replyToComment(el, p.text)) { await NexoStore.clearPending(); toast("Rascunho inserido: revise e envie ✔"); }
      } else if (p.kind === "dm") {
        const editor = document.querySelector(".msg-form__contenteditable, [contenteditable='true'][aria-label*='mensagem' i], [contenteditable='true'][aria-label*='message' i]");
        if (!editor) return;
        insertInto(editor, p.text);
        NexoStore.bumpStat("dm");
        await NexoStore.setQueueStatus(threadKey(), "done");
        await NexoStore.clearPending();
        toast("Rascunho inserido: revise e envie ✔");
      }
    } finally { pendingBusy = false; }
  }

  // 3) Mensagens: templates de DM no composer
  function conversationContact() {
    const link = $('.msg-thread__link-to-profile, .msg-overlay-bubble-header a[href*="/in/"], a.msg-thread__link-to-profile')
      || [...document.querySelectorAll('main a[href*="/in/"]')].find((x) => x.innerText.trim());
    const id = NexoStore.idFromUrl(link?.href);
    const name = text(".msg-entity-lockup__entity-title, .msg-overlay-bubble-header__title, h2.msg-entity-lockup__entity-title")
      || (link?.innerText || "").split("\n")[0].trim();
    return { id, name };
  }

  function enhanceComposer(form) {
    if (form.dataset.nexo) return;
    form.dataset.nexo = "1";
    const c = chip("⚡ Templates Nexo", async (btn) => {
      const conv = conversationContact();
      const { contacts } = await NexoStore.get();
      const contact = (conv.id && contacts[conv.id]) || conv;
      pickTemplate(btn, "dm", contact, async (value) => {
        const editor = form.querySelector(".msg-form__contenteditable, [contenteditable='true']");
        if (!editor) return;
        insertInto(editor, value);
        NexoStore.bumpStat("dm");
        NexoStore.setQueueStatus(threadKey(), "done");
        if (conv.id) {
          if (!contacts[conv.id]) await NexoStore.upsertContact({ id: conv.id, name: conv.name, url: `https://www.linkedin.com/in/${conv.id}/` });
          await NexoStore.logActivity(conv.id, "dm", "Rascunho de DM inserido");
        }
      });
    });
    const ai = chip("✨ Responder com IA", async (btn) => {
      const conv = conversationContact();
      const { contacts } = await NexoStore.get();
      const root = form.closest(".msg-overlay-conversation-bubble, .msg-convo-wrapper, main") || document;
      const thread = [...root.querySelectorAll(".msg-s-event-listitem")].slice(-12).map((li) => {
        const who = text(".msg-s-message-group__name", li) || (li.classList.contains("msg-s-event-listitem--other") ? conv.name : "Eu");
        return `${who || "?"}: ${text(".msg-s-event-listitem__body", li)}`;
      }).filter((l) => !l.endsWith(": "));
      const contact = slim(contacts[conv.id]) || { name: conv.name };
      pickAI(btn, thread.length ? "reply" : "dm", { thread, contact }, async (value) => {
        const editor = form.querySelector(".msg-form__contenteditable, [contenteditable='true']");
        if (!editor) return;
        insertInto(editor, value);
        NexoStore.bumpStat("dm");
        NexoStore.setQueueStatus(threadKey(), "done");
        if (conv.id && contacts[conv.id]) await NexoStore.logActivity(conv.id, "dm", "Resposta sugerida por IA inserida");
      });
    });
    c.classList.add("nexo-chip--composer");
    ai.classList.add("nexo-chip--composer");
    form.prepend(c, ai);
  }

  // Só o que a IA precisa saber do contato (nada de e-mail ou histórico completo)
  const slim = (c) => c && { name: c.name, headline: c.headline, company: c.company, stage: c.stage, notes: (c.notes || "").slice(0, 800), about: c.about, interests: c.interests };

  // Diálogo "Informações de contato" aberto pelo usuário: captura e-mail/sites que o LinkedIn já exibe
  async function scanContactInfo() {
    const dlg = $('div[role="dialog"] .pv-contact-info, div[role="dialog"] section.pv-contact-info__contact-type')?.closest('div[role="dialog"]');
    if (!dlg || dlg.dataset.nexo) return;
    const id = NexoStore.idFromUrl(location.href);
    const { contacts } = await NexoStore.get();
    if (!id || !contacts[id]) return;
    dlg.dataset.nexo = "1";
    const email = $('a[href^="mailto:"]', dlg)?.href.slice(7);
    const websites = [...dlg.querySelectorAll('section a[href^="http"]')].map((a) => a.href).filter((h) => !h.includes("linkedin.com"));
    const patch = {};
    if (email && email !== contacts[id].email) Object.assign(patch, { email, emailSource: "linkedin", emailScore: null });
    if (websites.length) patch.websites = [...new Set(websites)];
    if (Object.keys(patch).length) {
      await NexoStore.patchContact(id, patch);
      if (patch.email) await NexoStore.logActivity(id, "enrich", "E-mail capturado das Informações de contato");
      toast("Informações de contato salvas no Nexo ✔");
    }
  }

  function waitFor(fn, ms = 3000) {
    return new Promise((res) => {
      const t0 = Date.now();
      (function tick() { const v = fn(); if (v || Date.now() - t0 > ms) return res(v); setTimeout(tick, 150); })();
    });
  }

  // Ponte com a tarefa agendada do Claude (Claude in Chrome): a tarefa roda, numa aba do LinkedIn,
  //   window.postMessage({ type: "nexo:import", token, items: [...] }, "*")
  // e os rascunhos entram na Caixa de entrada. Sem o token pareado na aba Config, a mensagem é ignorada:
  // qualquer script da página poderia chamar postMessage. Nada é enviado: os itens só viram rascunhos para revisão.
  const KINDS = new Set(["dm", "comment", "invite"]);
  const CLASSES = new Set(["lead", "recrutador", "parceria", "peer", "substancia", "apoio", "ruido", "spam", "outro"]);
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  function parseImportItem(raw) {
    if (!raw || typeof raw !== "object" || !KINDS.has(raw.kind)) return null;
    let url;
    try { url = new URL(raw.url); } catch { return null; }
    if (url.origin !== "https://www.linkedin.com") return null; // só links do LinkedIn
    const name = str(raw.author?.name, 120);
    const text = str(raw.text, 2000);
    if (!name || !text) return null;
    const path = (/\/messaging\/thread\/[^/?#]+/.exec(url.pathname) || [])[0];
    const cUrn = url.searchParams.get("commentUrn");
    const id = raw.kind === "dm" && path ? `dm:${path}` : raw.kind === "comment" && cUrn ? `c:${commentKey(cUrn)}` : `t:${hashId(`${raw.kind}|${url.pathname}|${name}|${text}`)}`;
    const cls = CLASSES.has(raw.classification) ? raw.classification : "outro";
    const urgency = [1, 2, 3].includes(raw.urgency) ? raw.urgency : 2;
    return {
      id, kind: raw.kind, url: url.href, targetId: cUrn ? commentKey(cUrn) : null,
      author: { name, headline: str(raw.author?.headline, 200) || undefined },
      text, postText: str(raw.postText, 3000) || undefined,
      classification: cls, why: str(raw.why, 300) || undefined,
      draft: str(raw.draft, 3000) || undefined,
      priority: urgency === 1 || ["lead", "recrutador"].includes(cls) ? 1 : 2,
      source: "claude-triage"
    };
  }
  window.addEventListener("message", async (e) => {
    if (e.source !== window || e.data?.type !== "nexo:import") return;
    const { bridgeToken } = await NexoStore.getSettings();
    const reply = (r) => window.postMessage({ type: "nexo:import:result", ...r }, location.origin);
    if (!bridgeToken || e.data.token !== bridgeToken) return reply({ ok: false, error: "token inválido ou ponte desativada" });
    const raw = Array.isArray(e.data.items) ? e.data.items.slice(0, 100) : [];
    const items = raw.map(parseImportItem).filter(Boolean);
    // Rascunhos novos substituem os antigos do mesmo item (a triagem de hoje é mais atual)
    const added = await NexoStore.enqueue(items, { refreshDrafts: true });
    await NexoStore.saveSettings({ lastBridgeImport: { at: Date.now(), received: raw.length, accepted: items.length } });
    reply({ ok: true, received: raw.length, accepted: items.length, added, rejected: raw.length - items.length });
    if (items.length) toast(`Nexo: ${items.length} rascunho(s) da triagem do Claude na Caixa de entrada`);
  });

  // Diagnóstico: o painel pergunta o que o Nexo enxerga nesta aba (sem textos de mensagens, só estrutura)
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== "nexo:diagnose") return;
    (async () => {
      const st = await NexoStore.getSettings();
      const cands = location.pathname.startsWith("/notifications") ? notificationCandidates() : [];
      const parsed = notificationCards();
      const describe = (el) => el && `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${[...el.classList].slice(0, 3).map((c) => "." + c).join("")}`;
      reply({
        version: chrome.runtime.getManifest().version, path: location.pathname, me: st.me?.id || null,
        counts: {
          postLinks: document.querySelectorAll(POST_LINK).length, comments: document.querySelectorAll(COMMENT).length,
          posts: document.querySelectorAll("[data-nexo-post]").length, composers: document.querySelectorAll("form.msg-form, [contenteditable='true']").length,
          threadLinks: document.querySelectorAll('a[href*="/messaging/thread/"]').length, notifCandidates: cands.length, notifParsed: parsed.length
        },
        notifSamples: cands.slice(0, 3).map((c) => {
          const lines = c.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
          const hi = lines.findIndex((l) => NOTIF_RE.test(l));
          return {
            card: describe(c), lines: lines.length, headline: hi >= 0 ? lines[hi].replace(/^.+?\s+(commented|replied|mentioned|comentou|respondeu|mencionou)/i, "<nome> $1").slice(0, 80) : null,
            links: [...c.querySelectorAll("a[href]")].slice(0, 4).map((x) => x.getAttribute("href").replace(/[?#].*$/, "").replace(/\/in\/[^/]+/, "/in/<perfil>").slice(0, 70))
          };
        })
      });
    })();
    return true;
  });

  // LinkedIn é SPA: observa mudanças de DOM com debounce
  let pending = false;
  const scan = () => {
    pending = false;
    renderProfileBar();
    document.querySelectorAll("div.feed-shared-update-v2, [data-urn^='urn:li:activity'], [data-id^='urn:li:activity']").forEach((el) => {
      if (!el.parentElement?.closest("[data-nexo-post]")) { el.dataset.nexoPost = "1"; enhancePost(el); }
    });
    document.querySelectorAll("form.msg-form").forEach(enhanceComposer);
    // Fallback do composer: caixa editável de mensagem fora do form antigo
    document.querySelectorAll('[contenteditable="true"][aria-label*="mensagem" i], [contenteditable="true"][aria-label*="message" i]').forEach((ed) => {
      const host = ed.closest("form") || ed.parentElement;
      if (host && !host.closest("[data-nexo]")) enhanceComposer(host);
    });
    document.querySelectorAll(COMMENT).forEach(enhanceComment);
    scanContactInfo();
    scanCommentsQueue();
    scanInboxQueue();
    scanNotifications();
    handlePending();
  };
  new MutationObserver(() => { if (!pending) { pending = true; setTimeout(scan, 400); } })
    .observe(document.body, { childList: true, subtree: true });
  scan();
})();

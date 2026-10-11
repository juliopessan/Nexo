// Páginas mínimas com a mesma estrutura de classes que o content.js procura no LinkedIn.
export const profile = `<!doctype html><html><body><main>
  <img class="pv-top-card-profile-picture__image--show" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
  <h1>Julio Pessan</h1>
  <div class="text-body-medium">AI Solutions Architect</div>
  <span class="text-body-small inline">São Paulo, Brasil</span>
  <button aria-label="Empresa atual: Avanade">Avanade</button>
</main></body></html>`;

export const feed = `<!doctype html><html><body><main>
  <div class="feed-shared-update-v2" data-urn="urn:li:activity:1">
    <div class="update-components-actor">
      <a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/maria-silva/">
        <span class="update-components-actor__title"><span aria-hidden="true">Maria Silva</span></span>
        <span class="update-components-actor__description"><span aria-hidden="true">Head de Vendas</span></span>
      </a>
    </div>
    <div class="update-components-text">Adotamos agentes de IA no time comercial e o ciclo de vendas caiu 30%.</div>
    <div class="feed-shared-social-action-bar">
      <button class="react-button__trigger" aria-label="React Like" aria-pressed="false"
        onclick="this.setAttribute('aria-pressed','true')">Gostei</button>
      <button aria-label="Comment" onclick="document.getElementById('cbox').hidden=false">Comentar</button>
    </div>
    <div class="comments-comment-box" id="cbox" hidden><div class="ql-editor" contenteditable="true"></div></div>
  </div>
</main></body></html>`;

export const messaging = `<!doctype html><html><body><main>
  <div class="msg-convo-wrapper">
    <a class="msg-thread__link-to-profile" href="https://www.linkedin.com/in/maria-silva/">
      <h2 class="msg-entity-lockup__entity-title">Maria Silva</h2></a>
    <ul>
      <li class="msg-s-event-listitem msg-s-event-listitem--other"><span class="msg-s-message-group__name">Maria Silva</span>
        <p class="msg-s-event-listitem__body">Oi! Vi que vocês trabalham com IA. Como funciona o piloto?</p></li>
    </ul>
    <form class="msg-form"><div class="msg-form__contenteditable" contenteditable="true"></div></form>
  </div>
</main></body></html>`;

// "Interface nova": classes embaralhadas, só atributos estáveis (aria-label, data-urn, links /in/, contenteditable)
export const feedNewUi = `<!doctype html><html><body><main>
  <div data-urn="urn:li:activity:2" class="x9f2k">
    <a class="a1b2" href="https://www.linkedin.com/in/carlos-lima/"><span>Carlos Lima</span><br><span>CEO na Lima Tech</span></a>
    <div class="break-words">Contratamos nosso primeiro SDR com IA. Perguntas?</div>
    <div class="zz91">
      <button aria-label="Reagir com Gostei" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">Gostei</button>
      <button aria-label="Comentar" onclick="document.getElementById('nb').hidden=false">Comentar</button>
    </div>
    <div id="nb" hidden><div contenteditable="true" role="textbox"></div></div>
  </div>
</main></body></html>`;

export const messagingNewUi = `<!doctype html><html><body><main>
  <a href="https://www.linkedin.com/in/carlos-lima/">Carlos Lima</a>
  <div class="q81"><div contenteditable="true" aria-label="Escreva uma mensagem…"></div></div>
</main></body></html>`;

// Post do próprio usuário com 2 comentários: Ana (sem resposta) e Bruno (já respondido por Julio)
const comment = (urn, slug, name, body, inner = "") => `
  <article class="comments-comment-entity" data-id="${urn}">
    <a href="https://www.linkedin.com/in/${slug}/"><span class="comments-comment-meta__description-title">${name}</span></a>
    <div class="comments-comment-item__main-content">${body}</div>
    <div class="comments-comment-social-bar">
      <button aria-label="Reagir com Gostei ao comentário de ${name}" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">Gostei</button>
      <button aria-label="Responder ao comentário de ${name}" onclick="var b=this.closest('article').querySelector(':scope > .reply-box');b.hidden=false;var e=b.querySelector('[contenteditable]');if(!e.textContent)e.textContent='${name}';">Responder</button>
    </div>
    <div class="reply-box" hidden><div contenteditable="true" role="textbox"></div></div>
    ${inner}
  </article>`;
export const myPost = `<!doctype html><html><body><main>
  <div data-urn="urn:li:activity:99">
    <a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/julio-pessan/">
      <span class="update-components-actor__title"><span aria-hidden="true">Julio Pessan</span></span></a>
    <div class="update-components-text">Lançamos o Nexo: um assistente de engajamento para LinkedIn.</div>
    <div class="feed-shared-social-action-bar"><button aria-label="React Like" aria-pressed="false">Gostei</button><button aria-label="Comment">Comentar</button></div>
    <section>
      ${comment("urn:li:comment:(activity:99,1)", "ana-costa", "Ana Costa", "Que ideia boa! Funciona com Sales Navigator?")}
      ${comment("urn:li:comment:(activity:99,2)", "bruno-reis", "Bruno Reis", "Parabéns pelo lançamento!",
        comment("urn:li:comment:(activity:99,3)", "julio-pessan", "Julio Pessan", "Valeu, Bruno!"))}
    </section>
  </div>
</main></body></html>`;

export const inboxList = `<!doctype html><html><body><main>
  <ul>
    <li class="msg-conversation-listitem"><a href="/messaging/thread/2-abc/">
      <h3 class="msg-conversation-listitem__participant-names">Paula Nunes</h3>
      <p class="msg-conversation-card__message-snippet">Oi Julio, vamos marcar aquela conversa sobre o piloto?</p>
      <span class="msg-conversation-card__unread-count">1</span></a></li>
    <li class="msg-conversation-listitem"><a href="/messaging/thread/2-lida/">
      <h3 class="msg-conversation-listitem__participant-names">Rui Lido</h3>
      <p class="msg-conversation-card__message-snippet">Combinado, obrigado!</p></a></li>
  </ul>
  <form class="msg-form"><div class="msg-form__contenteditable" contenteditable="true"></div></form>
</main></body></html>`;

// Notificações no formato do texto real enviado pelo usuário (filtro "My posts")
const POST = "Nobody notices the token bill going up.  They notice it after it already went up. What finally made your team start watching token spend closely, a bad bill or a good habit?";
export const notifications = `<!doctype html><html><body><main>
  <h1>Notifications</h1>
  <section>
    <article class="nt-card"><a href="/feed/update/urn:li:activity:7001/">
      <span>Kosta Z. and 1 other reacted to your post.</span><p>${POST}</p><span>2 reactions • 1 comment</span></a><span>20h</span></article>
    <article class="nt-card"><a href="/feed/update/urn:li:activity:7001/?commentUrn=urn%3Ali%3Acomment%3A%28activity%3A7001%2C7002%29&dashCommentUrn=x">
      <span>Kosta Z. commented on your post.</span>
      <p>I work solo, so there's no ticket pile and nobody downstream to flag it. Even working alone, this stuff piles up on you.</p>
      <p>${POST}</p><span>2 reactions • 1 comment</span></a><span>20h</span></article>
    <article class="nt-card"><a href="/feed/update/urn:li:activity:7003/">
      <span>Xia Wu reacted to your post.</span><p>Nobody notices the token bill growing.</p><span>1 reaction</span></a><span>1w</span></article>
  </section>
</main></body></html>`;

// Página do post aberta pelo link da notificação (comentário com data-id no formato novo)
export const tokenPost = `<!doctype html><html><body><main>
  <div data-urn="urn:li:activity:7001">
    <a class="update-components-actor__meta-link" href="https://www.linkedin.com/in/julio-pessan/">
      <span class="update-components-actor__title"><span aria-hidden="true">Julio Pessan</span></span></a>
    <div class="update-components-text">${POST}</div>
    <article class="comments-comment-entity" data-id="urn:li:comment:(urn:li:activity:7001,7002)">
      <a href="https://www.linkedin.com/in/kosta-z/"><span class="comments-comment-meta__description-title">Kosta Z.</span></a>
      <div class="comments-comment-item__main-content">I work solo, so there's no ticket pile and nobody downstream to flag it. Even working alone, this stuff piles up on you.</div>
      <div><button aria-label="Like Kosta's comment" aria-pressed="false">Like</button>
        <button aria-label="Reply to Kosta Z.'s comment" onclick="var b=this.closest('article').querySelector('.reply-box');b.hidden=false;var e=b.querySelector('[contenteditable]');if(!e.textContent)e.textContent='Kosta Z.';">Reply</button></div>
      <div class="reply-box" hidden><div contenteditable="true" role="textbox"></div></div>
    </article>
  </div>
</main></body></html>`;

// Notificações "difíceis": sem nt-card, nome em <strong> separado, título duplicado para leitor de tela, link fora do texto
export const notificationsHard = `<!doctype html><html><body><main><div class="scaffold">
  <div class="x1"><div class="x2">
    <span class="visually-hidden" style="position:absolute;clip:rect(0 0 0 0)">Lia Prado commented on your post.</span>
    <div class="x3"><span><strong>Lia Prado</strong> commented on your post.</span></div>
    <div class="x4">Esse ponto sobre cache de prompts é ótimo. Vocês medem por feature?</div>
    <div class="x5">AI doesn't become expensive overnight.</div>
    <div class="x6">3 reactions • 1 comment</div><span>2h</span>
    <a class="x7" href="https://www.linkedin.com/feed/update/urn:li:activity:9001/?commentUrn=urn%3Ali%3Acomment%3A%28activity%3A9001%2C9002%29">Ver</a>
  </div></div>
  <div class="x1"><div class="x2"><div class="x3"><span><strong>Rui</strong> reacted to your post.</span></div>
    <a class="x7" href="https://www.linkedin.com/feed/update/urn:li:activity:9001/">Ver</a></div></div>
</div></main></body></html>`;

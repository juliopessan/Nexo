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

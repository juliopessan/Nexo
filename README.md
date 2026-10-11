# Nexo — Assistente de engajamento no LinkedIn (extensão Chrome)

O Nexo cuida do que dá trabalho no LinkedIn: **responder comentários, curtir, comentar e responder DMs**, com rascunhos de IA no seu tom de voz. Você revisa e envia com um clique.

## Como funciona
1. **Caixa de entrada** no painel lateral, com comentários sem resposta nos **seus** posts e DMs não lidas. Cada item gera 3 respostas com IA. Você escolhe e edita uma, e o botão **Abrir e inserir** leva até o post ou a conversa com o rascunho já no campo.
2. **Em cada comentário:** botões *✨ Responder com IA* (preserva a menção @nome) e *👍*.
3. **Em cada post:** *✨ Comentar com IA*, *💬 Comentar com template*, *👍 Curtir* e *＋ Autor no CRM*.
4. **Em cada DM:** *✨ Responder com IA*, que lê a conversa, e *⚡ Templates*.
5. **Metas diárias** de curtidas, comentários, respostas e DMs, com progresso no topo do painel.
6. **Pessoas e Pipeline:** um CRM leve de quem engaja com você, com notas, tags, follow-ups e exportação CSV.

7. **Tarefa agendada do Claude (computer use):** a sua tarefa diária, que usa o Claude in Chrome, lê o LinkedIn inteiro, classifica e escreve os rascunhos. No final, ela entrega tudo na Caixa de entrada do Nexo pela ponte (*Config → Tarefa agendada do Claude*). A ponte exige token de pareamento, só aceita links do LinkedIn e nunca envia nada.

**Primeiro passo:** abra o seu próprio perfil no LinkedIn e clique em **⭐ Este sou eu**. É assim que o Nexo sabe quais posts são seus.

## Instalar (modo desenvolvedor)
1. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione esta pasta.
3. Fixe o ícone e clique nele para abrir o painel lateral.

## Funcionalidades (detalhe)
- **Salvar perfis em 1 clique**: barra flutuante em `/in/...`, com nome, cargo, foto e local.
- **Feed**: em cada post aparecem os botões *＋ Autor no CRM*, *👍 Curtir* (curte e registra no histórico) e *💬 Comentar com template*.
- **DMs**: o botão *⚡ Templates Nexo* no composer preenche `{firstName}`, `{headline}` e `{company}`.
- **Painel lateral**: lista com busca e filtro, pipeline Kanban com arrastar e soltar, aba *Hoje* com follow-ups, notas, tags, histórico e exportação CSV.
- **Lembretes**: notificação de hora em hora para os follow-ups que vencem.

## Novidades da v0.2

### ✨ IA (Claude)
- **Feed**: o botão *✨ Comentar com IA* lê o texto do post e sugere 3 comentários com abordagens diferentes (insight, experiência, pergunta).
- **DMs**: o botão *✨ Responder com IA* lê as últimas 12 mensagens da conversa e sugere 3 respostas. Numa conversa nova, sugere uma abordagem.
- **Painel**: o botão *✨ Sugerir DM* no detalhe do contato usa a etapa e as notas. Clique numa sugestão para copiar.
- Configure em **Config**: a chave da Anthropic, o modelo (padrão `claude-opus-5-5`, com esforço baixo para responder rápido) e o campo *Sobre você*, para a IA escrever na sua voz.
- Texto de posts e conversas é tratado como dado, nunca como instrução. Para a IA vão apenas nome, cargo, empresa, etapa e notas do contato; o e-mail não é enviado.

### ☁️ Equipe e sincronização (servidor próprio)
O backend roda na **sua VPS**: PostgreSQL + API em Node (`server/`) + Caddy com HTTPS automático. Veja **[deploy/README.md](deploy/README.md)**.
- Cadastro só com **código de convite** da equipe ou com o **SIGNUP_CODE** do servidor (para fundadores): estranhos não criam conta.
- Cada pessoa só lê e escreve dados das equipes de que faz parte. O dono pode gerar um novo convite, e o antigo deixa de valer.
- Sincroniza a cada minuto e ~3 s após cada edição; o pull é paginado e o push vai em lotes.
- Conflitos: vence a edição mais recente de cada contato, garantido no banco. Escritas da mesma equipe são serializadas para o cursor nunca pular registros.
- Senhas com scrypt; tokens de sessão guardados só como hash (sha256), com expiração.

### 🔎 Enriquecimento
- **Do próprio LinkedIn**: ao abrir *Informações de contato* num perfil salvo, o Nexo guarda o e-mail e os sites que aparecem ali (fonte: `linkedin`).
- **Exa** (com a sua chave, exa.ai): o botão *🔎 Enriquecer* pesquisa a web e devolve um resumo profissional da pessoa, os temas sobre os quais ela fala e os dados da empresa (domínio, setor, porte, local, descrição), com **fontes e nível de confiança**. A IA usa o resumo e os temas para personalizar comentários e respostas.
- E-mail só aparece se estiver **publicado** para aquela pessoa. A Exa recebe instrução explícita para nunca deduzir um e-mail a partir de um padrão.
- Cada dado guarda a sua fonte. Um e-mail que veio do LinkedIn nunca é sobrescrito pela Exa.

## Atualizar sem perder dados
O Chrome **apaga todos os dados de uma extensão quando ela é removida**. Para atualizar:
1. Substitua os arquivos **na mesma pasta** (`git pull` ou descompacte o zip por cima).
2. Em `chrome://extensions`, clique em **⟳** no Nexo. **Não remova a extensão.**

Se precisar reinstalar, o Nexo tem duas cópias de segurança automáticas:
- **Arquivo:** `Downloads/Nexo/nexo-backup.json`, atualizado a cada mudança e uma vez por dia. Numa instalação nova, o painel mostra **Restaurar do arquivo**.
- **Servidor:** com login, as configurações e chaves ficam no seu cofre pessoal e voltam sozinhas no próximo login.

## Princípio de design: humano no controle
O Nexo **nunca envia nada sozinho**. Ele preenche o texto e você revisa e envia. Ações em massa automáticas violam os Termos do LinkedIn e podem levar ao bloqueio da conta.

Sem equipe configurada, os dados ficam **somente no seu navegador** (`chrome.storage.local`). Com equipe, também ficam no **seu** servidor. As chaves de API são usadas apenas pelo service worker, nunca pela página do LinkedIn.

**LGPD:** e-mails enriquecidos são dados pessoais. Use-os só para contato profissional com base legal (legítimo interesse) e apague-os quando a pessoa pedir.

## Limitação conhecida
Os seletores do DOM do LinkedIn mudam com frequência. Se um botão sumir, ajuste os seletores em `content.js`.

## Desenvolvimento e testes
```bash
cd server && npm ci && cd ..
export DATABASE_URL=postgres://nexo:nexo@localhost/nexo   # Postgres local de teste (é limpo pelos testes!)
(cd server && npm test)       # integração da API: auth, convites, permissões, LWW, concorrência
node tests/e2e.mjs            # 2 clientes da extensão sincronizando via servidor real
(cd tests/browser && npm ci && npm test)  # extensão carregada no Chromium em páginas no formato do LinkedIn
./scripts/build-extension.sh  # gera dist/nexo-<versão>.zip para a Chrome Web Store
```
A CI (`.github/workflows/ci.yml`) roda tudo isso em cada push e PR, com Postgres de verdade.

Publicação: veja [store/listing.md](store/listing.md) e [PRIVACY.md](PRIVACY.md).

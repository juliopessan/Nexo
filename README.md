# Nexo — CRM para LinkedIn (extensão Chrome)

**Nexo**: o *nexo* entre você e sua rede. Você salva contatos, organiza o funil, curte e comenta posts e responde DMs com templates, tudo sem sair do LinkedIn.

## Instalar (modo desenvolvedor)
1. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione esta pasta.
3. Fixe o ícone e clique nele para abrir o painel lateral.

## Funcionalidades
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
- **Hunter.io** (com a sua chave): o botão *🔎 Enriquecer* busca o e-mail profissional (com nota de confiança) e os dados da empresa: domínio, setor, porte e local.
- Cada dado guarda a sua fonte. Um e-mail que veio do LinkedIn nunca é sobrescrito por um palpite do Hunter.

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

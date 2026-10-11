# Deploy do servidor Nexo na sua VPS

## Instalação em 1 comando (recomendado)
Na VPS, como root:
```bash
curl -fsSL https://raw.githubusercontent.com/juliopessan/Nexo/main/deploy/install.sh | sh -s -- nexo.srv1774174.hstgr.cloud
```
Para atualizar depois, rode a cópia local: `sh /opt/nexo/deploy/install.sh SEU_DOMINIO`. O script instala o Docker (se faltar), gera senhas aleatórias no `.env`, sobe tudo, agenda o backup e mostra o **código de cadastro**. Rodar de novo atualiza o código e mantém os dados.

## Instalação manual
Requisitos: VPS Linux com Docker + Docker Compose, um domínio (ou subdomínio) apontando para o IP da VPS e as portas 80/443 liberadas.

```bash
git clone https://github.com/juliopessan/Nexo.git && cd Nexo/deploy
cp .env.example .env
nano .env                         # preencha NEXO_DOMAIN, POSTGRES_PASSWORD e SIGNUP_CODE
docker compose up -d --build
curl https://SEU_DOMINIO/health   # {"ok":true}
```

O Caddy emite o certificado HTTPS sozinho na primeira requisição. Se as portas 80/443 já estiverem em uso (Nginx/Apache), o instalador não sobe o Caddy: a API fica em `127.0.0.1:8787` e ele mostra a configuração para o seu servidor web.

## Já tenho PostgreSQL na VPS
Rode só a API apontando para o seu banco (o schema é criado automaticamente no primeiro boot):
```bash
cd server && npm ci --omit=dev
DATABASE_URL=postgres://usuario:senha@localhost:5432/nexo SIGNUP_CODE=... TRUST_PROXY=1 node index.js
```
Coloque-a atrás do seu proxy HTTPS (Nginx/Caddy) e use um usuário de banco dedicado, só com acesso ao database `nexo`.

## Primeiro acesso
1. Na extensão, aba **Config**: em *Endereço do servidor* informe `https://SEU_DOMINIO` e clique em **Salvar e autorizar**.
2. **Criar conta** com o `SIGNUP_CODE` e depois **Criar equipe**.
3. Compartilhe o **código de convite**: os colegas criam a conta com ele e já entram na equipe.

## Operação
- Backup: `deploy/backup.sh` (pg_dump diário, guarda 14 dias) — agende no cron.
- Atualizar: `git pull && docker compose up -d --build`.
- Logs: `docker compose logs -f api`.
- Trocar o convite (se vazar): botão **Novo convite** (só o dono da equipe).

## Entrar com Google
1. Acesse https://console.cloud.google.com/ e crie um projeto (ex.: "Nexo").
2. **APIs e serviços → Tela de consentimento OAuth**: tipo **Externo**, nome "Nexo", seu e-mail de suporte. Em **Usuários de teste**, adicione os e-mails que vão entrar.
3. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**
   - **URIs de redirecionamento autorizados:** `https://lgeenajlpmgihmgnobifccidbccooahc.chromiumapp.org/`
4. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`). Ele não é secreto. A *chave secreta do cliente* não é usada.
5. Na VPS:
   ```bash
   cd /opt/nexo/deploy
   sed -i "s|^GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=SEU_ID.apps.googleusercontent.com|" .env
   sed -i "s|^GOOGLE_ALLOWED_EMAILS=.*|GOOGLE_ALLOWED_EMAILS=seu.email@gmail.com|" .env
   docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d api
   ```
6. Na extensão: **Config → Entrar com Google**.

O ID da extensão é fixo (`lgeenajlpmgihmgnobifccidbccooahc`, definido pela chave pública no `manifest.json`), então o URI de redirecionamento vale para qualquer computador.
E-mails fora de `GOOGLE_ALLOWED_EMAILS` só entram com um **código de convite** de uma equipe.

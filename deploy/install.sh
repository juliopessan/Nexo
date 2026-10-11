#!/bin/sh
# Instalador do servidor Nexo numa VPS Linux (Ubuntu/Debian). Rode como root:
#   curl -fsSL https://raw.githubusercontent.com/juliopessan/Nexo/main/deploy/install.sh | sh -s -- SEU_DOMINIO
# Idempotente: rodar de novo atualiza o código e mantém o .env (senhas) e os dados.
set -eu
DOMAIN="${1:-}"
DIR=/opt/nexo
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
[ -n "$DOMAIN" ] || { echo "Uso: install.sh SEU_DOMINIO"; exit 1; }

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker não encontrado; instalando pelo script oficial (get.docker.com)."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "Plugin 'docker compose' ausente. Instale docker-compose-plugin e rode de novo."; exit 1; }
command -v git >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq git)

echo "==> Código em $DIR"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q --ff-only; else git clone -q https://github.com/juliopessan/Nexo.git "$DIR"; fi
# O script baixado pelo curl pode vir de um cache antigo do GitHub: continua sempre pela cópia recém-atualizada
if [ -z "${NEXO_REEXEC:-}" ]; then
  echo "==> Continuando com $DIR/deploy/install.sh ($(git -C "$DIR" log --oneline -1))"
  NEXO_REEXEC=1 exec sh "$DIR/deploy/install.sh" "$DOMAIN"
fi
cd "$DIR/deploy"

echo "==> DNS de $DOMAIN"
MYIP=$(curl -fsS4 https://api.ipify.org || true)
DNSIP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
if [ -z "$DNSIP" ]; then
  echo "AVISO: $DOMAIN não resolve. Crie um registro A apontando para $MYIP, senão o HTTPS não será emitido."
elif [ -n "$MYIP" ] && [ "$DNSIP" != "$MYIP" ]; then
  echo "AVISO: $DOMAIN aponta para $DNSIP, mas esta VPS é $MYIP. O HTTPS só funciona quando apontar para cá."
else
  echo "OK: $DOMAIN -> $DNSIP"
fi

if [ ! -f .env ]; then
  echo "==> Gerando .env com segredos aleatórios"
  umask 077
  cat > .env <<ENV
NEXO_DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SIGNUP_CODE=$(openssl rand -hex 12)
SESSION_DAYS=30
ENV
else
  sed -i "s/^NEXO_DOMAIN=.*/NEXO_DOMAIN=$DOMAIN/" .env
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  echo "==> Liberando 80/443 no ufw"; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

# Portas 80/443 ocupadas por um servidor web já existente? Então não sobe o Caddy:
# a API fica em 127.0.0.1:8787 e o proxy existente encaminha para ela.
busy=$( (ss -ltnpH 2>/dev/null || true) | awk '$4 ~ /:(80|443)$/' )
docker compose rm -sf caddy >/dev/null 2>&1 || true
if [ -n "$busy" ] && ! echo "$busy" | grep -q docker-proxy; then
  OWNER=$(echo "$busy" | grep -o 'users:(("[^"]*' | head -1 | sed 's/.*"//')
  echo "==> Portas 80/443 em uso por: ${OWNER:-desconhecido}. Usando o servidor web existente."
  PROFILE=""
else
  PROFILE="--profile caddy"
fi

# Traefik em container (comum em VPS Hostinger): roteia o domínio para a API via labels do Docker.
COMPOSE="docker compose"
if [ -z "$PROFILE" ] && [ "${OWNER:-}" = traefik ]; then
  TCID=$(docker ps --format '{{.ID}} {{.Image}}' | awk 'tolower($2) ~ /traefik/ {print $1; exit}')
  if [ -n "$TCID" ]; then
    ARGS=$(docker inspect -f '{{join .Args " "}} {{join .Config.Cmd " "}}' "$TCID" | tr ' ' '\n')
    # entrypoint HTTPS (:443) e resolver ACME, pelos argumentos do Traefik; senão os nomes mais comuns
    EP=$(echo "$ARGS" | sed -n 's/^--entrypoints\.\([^.]*\)\.address=.*:443$/\1/p' | head -1)
    CR=$(echo "$ARGS" | sed -n 's/^--certificatesresolvers\.\([^.]*\)\.acme.*/\1/p' | head -1)
    EP=${TRAEFIK_ENTRYPOINT:-${EP:-websecure}}
    CR=${TRAEFIK_CERTRESOLVER:-${CR:-letsencrypt}}
    NETMODE=$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$TCID")
    NET=""
    [ "$NETMODE" != host ] && NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$TCID" | awk '{print $1}')
    echo "==> Traefik em container ($TCID): entrypoint=$EP certresolver=$CR rede=${NET:-host}"
    {
      echo "services:"
      echo "  api:"
      echo "    labels:"
      echo "      traefik.enable: \"true\""
      echo "      traefik.http.routers.nexo.rule: \"Host(\`$DOMAIN\`)\""
      echo "      traefik.http.routers.nexo.entrypoints: \"$EP\""
      echo "      traefik.http.routers.nexo.tls: \"true\""
      echo "      traefik.http.routers.nexo.tls.certresolver: \"$CR\""
      echo "      traefik.http.services.nexo.loadbalancer.server.port: \"8787\""
      if [ -n "$NET" ]; then
        echo "      traefik.docker.network: \"$NET\""
        echo "    networks: [default, edge]"
        echo "networks:"
        echo "  edge:"
        echo "    external: true"
        echo "    name: $NET"
      fi
    } > docker-compose.traefik.yml
  else
    echo "Traefik roda fora do Docker: adicione um router no arquivo de configuração dele apontando para http://127.0.0.1:8787"
  fi
fi
[ -f docker-compose.traefik.yml ] && COMPOSE="docker compose -f docker-compose.yml -f docker-compose.traefik.yml"

echo "==> Subindo containers"
$COMPOSE $PROFILE up -d --build --remove-orphans

echo "==> Aguardando a API"
i=0
until $COMPOSE exec -T api wget -qO- http://127.0.0.1:8787/health >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 30 ] && { echo "API não respondeu. Veja: docker compose logs api"; exit 1; }; sleep 2
done

CRON="0 3 * * * $DIR/deploy/backup.sh >/dev/null 2>&1"
( crontab -l 2>/dev/null | grep -v "deploy/backup.sh"; echo "$CRON" ) | crontab -

if [ -z "$PROFILE" ] && [ ! -f docker-compose.traefik.yml ]; then
  echo
  echo "API rodando em http://127.0.0.1:8787 (só local). Falta o HTTPS no seu servidor web."
  case "${OWNER:-}" in
    nginx*)
      echo "Nginx detectado. Crie /etc/nginx/sites-available/nexo com:"
      echo "  server { listen 80; server_name $DOMAIN;"
      echo "    location / { proxy_pass http://127.0.0.1:8787; proxy_set_header Host \$host;"
      echo "      proxy_set_header X-Forwarded-For \$remote_addr; proxy_set_header X-Forwarded-Proto \$scheme; } }"
      echo "Depois: ln -s /etc/nginx/sites-available/nexo /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx"
      echo "HTTPS: certbot --nginx -d $DOMAIN";;
    apache2*|httpd*)
      echo "Apache detectado: a2enmod proxy proxy_http e crie um VirtualHost para $DOMAIN com"
      echo "  ProxyPass / http://127.0.0.1:8787/  e  ProxyPassReverse / http://127.0.0.1:8787/"
      echo "HTTPS: certbot --apache -d $DOMAIN";;
    *)
      echo "Configure o proxy reverso existente para encaminhar https://$DOMAIN -> http://127.0.0.1:8787";;
  esac
  echo "Teste local agora: curl http://127.0.0.1:8787/health"
fi
echo
if [ -f docker-compose.traefik.yml ]; then
  echo "==> Testando HTTPS via Traefik (o certificado pode levar até 1 min)"
  i=0
  until curl -fsS --max-time 5 "https://$DOMAIN/health" >/dev/null 2>&1; do
    i=$((i+1)); [ $i -gt 12 ] && { echo "HTTPS ainda não respondeu. Diagnóstico: docker logs --tail 50 $TCID 2>&1 | grep -i -E 'nexo|acme|error'"; break; }; sleep 5
  done
  [ $i -le 12 ] && echo "OK: https://$DOMAIN/health respondeu com certificado válido."
fi
echo "Teste: curl https://$DOMAIN/health"
echo "Na extensão (Config): servidor https://$DOMAIN"
echo "Código de cadastro (fundadores): $(grep ^SIGNUP_CODE= .env | cut -d= -f2)"
echo "Guarde-o; ele também fica em $DIR/deploy/.env"

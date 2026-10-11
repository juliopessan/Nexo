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

echo "==> Subindo containers"
docker compose up -d --build

echo "==> Aguardando a API"
i=0
until docker compose exec -T api wget -qO- http://127.0.0.1:8787/health >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 30 ] && { echo "API não respondeu. Veja: docker compose logs api"; exit 1; }; sleep 2
done

CRON="0 3 * * * $DIR/deploy/backup.sh >/dev/null 2>&1"
( crontab -l 2>/dev/null | grep -v "deploy/backup.sh"; echo "$CRON" ) | crontab -

echo
echo "Nexo no ar. Teste: curl https://$DOMAIN/health"
echo "Na extensão (Config): servidor https://$DOMAIN"
echo "Código de cadastro (fundadores): $(grep ^SIGNUP_CODE= .env | cut -d= -f2)"
echo "Guarde-o; ele também fica em $DIR/deploy/.env"

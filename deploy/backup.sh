#!/bin/sh
# Backup diário do banco. Agende no cron da VPS: 0 3 * * * /caminho/deploy/backup.sh
set -eu
cd "$(dirname "$0")"
mkdir -p backups
docker compose exec -T db pg_dump -U nexo -Fc nexo > "backups/nexo-$(date +%F).dump"
find backups -name 'nexo-*.dump' -mtime +14 -delete

#!/bin/sh
# Бэкап PostgreSQL VOVPLAN в gzip с датой. Хранит последние 14.
# Cron (ежедневно в 3:00):  0 3 * * * /path/to/vovplan/scripts/backup-db.sh
set -e
cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y-%m-%d_%H%M)
FILE="$BACKUP_DIR/vovplan-$STAMP.sql.gz"

# Читаем POSTGRES_* из .env
set -a; . ./.env; set +a

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$FILE"

echo "backup: $FILE ($(du -h "$FILE" | cut -f1))"

# Чистим старые (оставляем 14 последних)
ls -1t "$BACKUP_DIR"/vovplan-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

# Восстановление:
#   gunzip -c backups/vovplan-YYYY-MM-DD_HHMM.sql.gz | \
#     docker compose -f docker-compose.prod.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

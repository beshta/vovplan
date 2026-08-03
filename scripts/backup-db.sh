#!/usr/bin/env bash
# Бэкап PostgreSQL VOVPLAN в gzip с датой. Хранит последние 14.
#
# Cron (ежедневно в 3:00):
#   0 3 * * * /home/beshta/vovplan/scripts/backup-db.sh >> /home/beshta/vovplan/backup.log 2>&1
#
# pipefail обязателен: без него упавший pg_dump всё равно оставлял бы файл
# (gzip отрабатывает успешно на пустом входе), и битый бэкап выглядел бы
# нормальным до самого восстановления.
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"
# На этом VPS диск тесный — не добиваем его бэкапами
MIN_FREE_MB="${MIN_FREE_MB:-500}"

# cron запускается с урезанным PATH, docker в нём может не оказаться
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

mkdir -p "$BACKUP_DIR"

free_mb=$(df -Pm . | awk 'NR==2 {print $4}')
if [ "$free_mb" -lt "$MIN_FREE_MB" ]; then
  echo "$(date '+%F %T') ОШИБКА: на диске $free_mb МБ — меньше порога $MIN_FREE_MB МБ, бэкап пропущен" >&2
  exit 1
fi

set -a; . ./.env; set +a

STAMP=$(date +%Y-%m-%d_%H%M)
FILE="$BACKUP_DIR/vovplan-$STAMP.sql.gz"
TMP="$FILE.part"

# Пишем во временный файл: незавершённый бэкап не должен выглядеть как готовый
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$TMP"

# Проверяем, что дамп целый и не пустой — иначе смысла в нём нет
if ! gzip -t "$TMP" 2>/dev/null; then
  rm -f "$TMP"
  echo "$(date '+%F %T') ОШИБКА: архив повреждён" >&2
  exit 1
fi
if ! gunzip -c "$TMP" | grep -q 'PostgreSQL database dump'; then
  rm -f "$TMP"
  echo "$(date '+%F %T') ОШИБКА: в дампе нет данных (упал pg_dump?)" >&2
  exit 1
fi

mv "$TMP" "$FILE"
echo "$(date '+%F %T') бэкап: $FILE ($(du -h "$FILE" | cut -f1))"

# Чистим старые
ls -1t "$BACKUP_DIR"/vovplan-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# Восстановление:
#   gunzip -c backups/vovplan-YYYY-MM-DD_HHMM.sql.gz | \
#     docker compose -f docker-compose.prod.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
#
# ВНИМАНИЕ: здесь только база. Загруженные модели и текстуры ландшафта лежат
# в docker-томе vovplan_uploads и сюда НЕ попадают — их бэкап отдельно:
#   docker run --rm -v vovplan_uploads:/d -v "$PWD/backups":/b alpine \
#     tar czf /b/uploads-$(date +%F).tar.gz -C /d .

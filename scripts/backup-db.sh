#!/usr/bin/env bash
# Бэкап VOVPLAN: база PostgreSQL + файлы проектов (модели, текстуры ландшафта).
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
# Архив файлов заметно тяжелее дампа — храним меньше копий
KEEP_FILES="${KEEP_FILES:-4}"
# На этом VPS диск тесный — не добиваем его бэкапами
MIN_FREE_MB="${MIN_FREE_MB:-500}"
# Файлы проектов растут; каждый день их архивировать незачем
FILES_EVERY_DAYS="${FILES_EVERY_DAYS:-7}"
# Куда выгружать наружу (rclone remote, например "backup:vovplan").
# Пусто — выгрузки нет, бэкап остаётся только на этом же диске.
REMOTE="${BACKUP_REMOTE:-}"

# cron запускается с урезанным PATH, docker в нём может не оказаться
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

log() { echo "$(date '+%F %T') $*"; }
fail() { echo "$(date '+%F %T') ОШИБКА: $*" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"

free_mb=$(df -Pm . | awk 'NR==2 {print $4}')
[ "$free_mb" -ge "$MIN_FREE_MB" ] || fail "на диске $free_mb МБ — меньше порога $MIN_FREE_MB МБ, бэкап пропущен"

set -a; . ./.env; set +a

STAMP=$(date +%Y-%m-%d_%H%M)
COMPOSE="docker compose -f docker-compose.prod.yml"

# ── База ─────────────────────────────────────────
DB_FILE="$BACKUP_DIR/vovplan-$STAMP.sql.gz"
TMP="$DB_FILE.part"

# Пишем во временный файл: незавершённый бэкап не должен выглядеть как готовый
$COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$TMP"

gzip -t "$TMP" 2>/dev/null || { rm -f "$TMP"; fail "архив базы повреждён"; }
gunzip -c "$TMP" | grep -q 'PostgreSQL database dump' || { rm -f "$TMP"; fail "в дампе нет данных (упал pg_dump?)"; }

mv "$TMP" "$DB_FILE"
log "база: $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"

ls -1t "$BACKUP_DIR"/vovplan-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# ── Файлы проектов ───────────────────────────────
# Модели GLB и текстуры ландшафта лежат в docker-томе и в дамп НЕ входят.
# Без них восстановленные проекты открываются пустыми.
FILES_FILE=""
newest_files=$(ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | head -1 || true)
need_files=1
if [ -n "$newest_files" ]; then
  age_days=$(( ($(date +%s) - $(date -r "$newest_files" +%s)) / 86400 ))
  [ "$age_days" -ge "$FILES_EVERY_DAYS" ] || need_files=0
fi

if [ "$need_files" = "1" ]; then
  FILES_FILE="$BACKUP_DIR/uploads-$STAMP.tar.gz"
  TMPF="$FILES_FILE.part"
  # Читаем том напрямую: приложение при этом останавливать не нужно
  docker run --rm \
    -v vovplan_uploads:/data:ro \
    -v "$(pwd)/$BACKUP_DIR":/out \
    alpine tar czf "/out/$(basename "$TMPF")" -C /data . 2>/dev/null \
    || fail "не удалось заархивировать файлы проектов"

  tar tzf "$TMPF" >/dev/null 2>&1 || { rm -f "$TMPF"; fail "архив файлов повреждён"; }
  mv "$TMPF" "$FILES_FILE"
  log "файлы: $FILES_FILE ($(du -h "$FILES_FILE" | cut -f1))"

  ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +$((KEEP_FILES + 1)) | xargs -r rm -f
else
  log "файлы: пропущено (свежий архив младше $FILES_EVERY_DAYS дн.)"
fi

# ── Выгрузка наружу ──────────────────────────────
# Бэкап на том же диске не спасает от потери сервера. Настройка — в DEPLOY.md.
if [ -z "$REMOTE" ]; then
  log "ВНИМАНИЕ: внешнее хранилище не настроено (BACKUP_REMOTE) — копии только на этом сервере"
elif ! command -v rclone >/dev/null 2>&1; then
  log "ВНИМАНИЕ: BACKUP_REMOTE задан, но rclone не установлен — выгрузка пропущена"
else
  rclone copy "$DB_FILE" "$REMOTE/db/" --quiet || fail "выгрузка базы не удалась"
  [ -n "$FILES_FILE" ] && { rclone copy "$FILES_FILE" "$REMOTE/files/" --quiet || fail "выгрузка файлов не удалась"; }
  # Чистим на той стороне по тому же правилу, что и локально
  rclone delete "$REMOTE/db/" --min-age "${KEEP}d" --quiet 2>/dev/null || true
  rclone delete "$REMOTE/files/" --min-age "$((KEEP_FILES * FILES_EVERY_DAYS))d" --quiet 2>/dev/null || true
  log "выгружено в $REMOTE"
fi

# Восстановление:
#   база:
#     gunzip -c backups/vovplan-ГГГГ-ММ-ДД_ЧЧММ.sql.gz | \
#       docker compose -f docker-compose.prod.yml exec -T postgres \
#         psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
#   файлы:
#     docker run --rm -v vovplan_uploads:/data -v "$PWD/backups":/in \
#       alpine tar xzf /in/uploads-ГГГГ-ММ-ДД_ЧЧММ.tar.gz -C /data

# VOVPLAN — деплой на VPS (Docker + Caddy + PostgreSQL)

Продакшн-стек: **Caddy** (статика фронта + reverse proxy + авто-TLS Let's Encrypt) →
**backend** (Fastify) → **PostgreSQL+PostGIS**. Всё в Docker Compose.

## Предварительно (уже сделано)
- Домен `vovplan.com` зарегистрирован, A-запись → IP VPS (`45.153.188.82`).
- Желательно добавить A-запись и для `www.vovplan.com` → тот же IP.

## Шаги на VPS (Beget)

**1. Установить Docker** (если ещё нет):
```bash
curl -fsSL https://get.docker.com | sh
```

**2. Открыть порты 80 и 443** в firewall (если включён):
```bash
ufw allow 80 && ufw allow 443
```

**3. Клонировать репозиторий:**
```bash
git clone https://github.com/beshta/vovplan.git
cd vovplan
```

**4. Создать `.env` из примера и заполнить секреты:**
```bash
cp .env.production.example .env
nano .env
```
- `POSTGRES_PASSWORD` — надёжный пароль.
- `JWT_SECRET` — сгенерировать: `openssl rand -base64 48` и вставить.
- `SITE_ADDRESS` / `CORS_ORIGINS` — оставить с `vovplan.com` (уже верны).

**5. Поднять стек** (первая сборка ~3–5 мин):
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```
Caddy сам получит TLS-сертификат для `vovplan.com` при первом обращении.

**6. Проверить:**
```bash
docker compose -f docker-compose.prod.yml ps      # все healthy/running
curl -I https://vovplan.com                        # 200
```
Открыть **https://vovplan.com** — должна открыться страница входа.

**7. Создать первого пользователя** — зарегистрироваться через UI (`/register`).

## Обновление до новой версии
```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```
Схема БД применяется автоматически при старте backend (`prisma db push`).
Данные (БД, загруженные файлы, TLS-сертификаты) хранятся в volumes и переживают пересборку.

## Бэкапы

`scripts/backup-db.sh` сохраняет **и базу, и файлы проектов**:

| Что | Как часто | Хранится |
|---|---|---|
| Дамп Postgres (`vovplan-*.sql.gz`) | ежедневно | 14 копий |
| Файлы: модели GLB и текстуры ландшафта (`uploads-*.tar.gz`) | раз в 7 дней | 4 копии |

Файлы лежат в docker-томе `vovplan_uploads` и в дамп базы **не входят** — без
них восстановленные проекты откроются пустыми. Архив снимается с тома напрямую,
останавливать приложение не требуется.

Скрипт пишет во временный файл и проверяет целостность: незавершённый или
битый архив не заменит предыдущий. Если свободно меньше 500 МБ — не запускается.

**Установка cron:**
```bash
cd ~/vovplan
chmod +x scripts/backup-db.sh
./scripts/backup-db.sh                 # разовый прогон
ls -lh backups/
crontab -e
```
```
0 3 * * * /home/beshta/vovplan/scripts/backup-db.sh >> /home/beshta/vovplan/backup.log 2>&1
```

### Выгрузка на внешнее хранилище

⚠️ **Без неё бэкапы лежат на том же диске, что и база** — от потери или сбоя
сервера они не спасают. Скрипт при каждом запуске об этом предупреждает в лог.

Выгрузка идёт через [rclone](https://rclone.org) — он умеет S3, Яндекс Object
Storage, Selectel, Google Drive и десятки других:

```bash
# 1. Установить
curl https://rclone.org/install.sh | sudo bash

# 2. Настроить хранилище (мастер спросит тип и ключи)
rclone config          # назовите remote, например: backup

# 3. Проверить, что пишется
rclone lsd backup:

# 4. Включить в бэкапе — добавить в ~/vovplan/.env
echo 'BACKUP_REMOTE=backup:vovplan' >> ~/vovplan/.env
```

После этого каждый прогон копирует свежие архивы в `<remote>/db/` и
`<remote>/files/` и удаляет там устаревшие по тем же правилам.

**Восстановление:**
```bash
# база
gunzip -c backups/vovplan-ГГГГ-ММ-ДД_ЧЧММ.sql.gz |   docker compose -f docker-compose.prod.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

# файлы проектов
docker run --rm -v vovplan_uploads:/data -v "$PWD/backups":/in   alpine tar xzf /in/uploads-ГГГГ-ММ-ДД_ЧЧММ.tar.gz -C /data
```

## Диагностика
```bash
docker compose -f docker-compose.prod.yml logs -f backend   # логи бэкенда
docker compose -f docker-compose.prod.yml logs -f web       # логи Caddy/TLS
```
- **TLS не выдаётся** → проверьте, что DNS `vovplan.com` указывает на этот сервер и порт 80 открыт (нужен для ACME-проверки).
- **502 на /api** → backend не поднялся; смотрите его логи (частая причина — неверный `DATABASE_URL`/пароль).

## Автодеплой через GitHub Actions

`.github/workflows/deploy.yml` обновляет прод после **успешного** CI (сломанная
сборка не уедет), плюс есть кнопка ручного запуска на вкладке Actions.
Пока секреты не заданы — шаг пропускается с предупреждением.

**Разовая настройка.** На VPS создать ключ для деплоя и разрешить вход по нему:
```bash
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/vovplan_deploy -N ""
cat ~/.ssh/vovplan_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/vovplan_deploy          # приватный ключ — скопировать целиком
```

В репозитории → **Settings → Secrets and variables → Actions → New repository secret**:

| Секрет | Значение |
|---|---|
| `DEPLOY_SSH_KEY` | приватный ключ целиком (с `-----BEGIN...` и `-----END...`) **или** его base64 |
| `DEPLOY_HOST` | `45.153.188.82` |
| `DEPLOY_USER` | пользователь на VPS (например `root`) |
| `DEPLOY_DIR` | путь к репозиторию на VPS (например `/root/vovplan`) |

⚠️ Приватный ключ даёт полный доступ к серверу — храните только в секретах
GitHub, в репозиторий не коммитьте и никому не пересылайте. Если ключ куда-то
утёк — сразу удалите его строку из `~/.ssh/authorized_keys` на сервере и
сделайте новый.

**Если ssh падает с `error in libcrypto`** — значит ключ в секрете побит:
потерялись строки `-----BEGIN/END-----`, перевод строки в конце или пришли
CRLF. Надёжный способ — положить в секрет base64 одной строкой, воркфлоу его
распознаёт сам:
```bash
base64 -w0 ~/.ssh/vovplan_deploy     # вывод целиком → в секрет
```

После настройки каждый пуш в `main` с зелёным CI сам обновляет vovplan.com;
воркфлоу в конце проверяет, что сайт отвечает 200.

**Образы собираются в Actions, а не на VPS.** Сборка на месте оставляла до 4 ГБ
кэша buildkit в `/var/lib/containerd` при диске в 14 ГБ, и деплой упирался в
`no space left on device`. Теперь воркфлоу публикует образы в GitHub Container
Registry, а сервер делает только `docker pull` — на нём не остаётся ни
build-кэша, ни промежуточных слоёв.

Ручная сборка на сервере всё ещё возможна (`up -d --build`), но обычно не нужна.

Если диск снова забился — чистить надо именно containerd, обычный
`docker system prune` до него не достаёт:
```bash
docker buildx du            # реальный размер кэша buildkit
docker buildx prune -af
```

## Заметки
- Файлы моделей и текстур ландшафта хранятся в volume `uploads` (на диске VPS). Для масштабирования на несколько серверов позже можно вынести в S3/MinIO.
- Redis/MinIO из dev-`infrastructure/docker-compose.yml` в проде **не нужны** — код их не использует.

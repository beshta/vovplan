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
```bash
chmod +x scripts/backup-db.sh
./scripts/backup-db.sh              # разовый бэкап в ./backups
crontab -e                          # ежедневно в 3:00:
# 0 3 * * * cd /root/vovplan && ./scripts/backup-db.sh >> backup.log 2>&1
```
Восстановление — команда в конце `scripts/backup-db.sh`.

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
| `DEPLOY_SSH_KEY` | приватный ключ целиком (с `-----BEGIN...` и `-----END...`) |
| `DEPLOY_HOST` | `45.153.188.82` |
| `DEPLOY_USER` | пользователь на VPS (например `root`) |
| `DEPLOY_DIR` | путь к репозиторию на VPS (например `/root/vovplan`) |

⚠️ Приватный ключ даёт полный доступ к серверу — храните только в секретах
GitHub, в репозиторий не коммитьте.

После настройки каждый пуш в `main` с зелёным CI сам обновляет vovplan.com;
воркфлоу в конце проверяет, что сайт отвечает 200.

## Заметки
- Файлы моделей и текстур ландшафта хранятся в volume `uploads` (на диске VPS). Для масштабирования на несколько серверов позже можно вынести в S3/MinIO.
- Redis/MinIO из dev-`infrastructure/docker-compose.yml` в проде **не нужны** — код их не использует.

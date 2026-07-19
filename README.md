# VOVPLAN

> Платформа совместного 3D-просмотра территориальных проектов

Веб-платформа для коллективного 3D-просмотра проектов (фестивали, заводы, турбазы) с ландшафтом, объектами и инженерными коммуникациями.

## Возможности

- 🌍 **3D-ландшафт** с реальными геодезическими данными
- 🏗 **Размещение объектов** от разных авторов
- 🔧 **Инженерные коммуникации** — подземные и подвесные сети с режимом «Просвет»
- 👥 **Ролевая модель**: Master → Designer → Super Spectator → Spectator → External Spectator
- 📱 **Кроссплатформенность**: PC, Mac, Android, iOS
- ⚡ **Ленивая загрузка** — мгновенный показ сцены с прогрессивной детализацией
- 🤝 **Real-time коллаборация** — присутствие, живые курсоры и синхронизация изменений (Socket.io)

## Технологии

- **Frontend:** React 18, TypeScript, Vite, React Three Fiber, TailwindCSS
- **Backend:** Node.js 20, Fastify, Prisma ORM, Socket.io
- **БД:** PostgreSQL 16 + PostGIS, Redis 7
- **Хранилище:** MinIO (S3) для 3D-ассетов

## Быстрый старт (dev)

> В dev-режиме Docker **не нужен**: БД — SQLite (`packages/backend/prisma/dev.db`),
> файлы моделей хранятся локально в `./uploads`. PostgreSQL/Redis/MinIO из
> `infrastructure/docker-compose.yml` понадобятся только для продакшна.

```bash
# 1. Клонировать репозиторий
git clone https://github.com/beshta/vovplan.git
cd vovplan

# 2. Установить зависимости
npm install

# 3. Скопировать .env
cp .env.example .env

# 4. Применить схему БД (SQLite, создастся автоматически)
npm run db:push

# 5. Запустить dev-серверы (backend :4000 + frontend :5173)
npm run dev
```

- Frontend: http://localhost:5173 (фронт ходит на бэкенд через vite-прокси `/api` и `/socket.io`)
- Backend: http://localhost:4000

## Продакшн: PostgreSQL

Дев работает на SQLite (`prisma/schema.prisma`), прод — на PostgreSQL
(`prisma/schema.postgres.prisma`). Общая часть обеих схем идентична —
CI падает, если они разошлись.

```bash
# 1. Поднять инфраструктуру (PostgreSQL+PostGIS, Redis, MinIO)
cd infrastructure && docker compose up -d && cd ..

# 2. Задать DATABASE_URL (postgresql://...) в окружении

# 3. Сгенерировать клиент и применить схему из postgres-варианта
npm run db:generate:pg --workspace packages/backend
npm run db:push:pg     --workspace packages/backend   # или db:migrate:pg при наличии миграций

# 4. Собрать и запустить
npm run build
npm run start --workspace packages/backend
```

## Структура

```
packages/
  shared/    — общие типы, константы, схемы валидации
  backend/   — API сервер (Fastify + Prisma)
  frontend/  — веб-приложение (React + R3F)
```

## Лицензия

MIT

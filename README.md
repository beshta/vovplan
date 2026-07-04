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

## Технологии

- **Frontend:** React 18, TypeScript, Vite, React Three Fiber, TailwindCSS
- **Backend:** Node.js 20, Fastify, Prisma ORM, Socket.io
- **БД:** PostgreSQL 16 + PostGIS, Redis 7
- **Хранилище:** MinIO (S3) для 3D-ассетов

## Быстрый старт

```bash
# 1. Клонировать репозиторий
git clone https://github.com/beshta/vovplan.git
cd vovplan

# 2. Установить зависимости
npm install

# 3. Скопировать .env
cp .env.example .env

# 4. Запустить инфраструктуру (PostgreSQL, Redis, MinIO)
cd infrastructure && docker compose up -d && cd ..

# 5. Применить схему БД
npm run db:push

# 6. Запустить dev-серверы
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000

## Структура

```
packages/
  shared/    — общие типы, константы, схемы валидации
  backend/   — API сервер (Fastify + Prisma)
  frontend/  — веб-приложение (React + R3F)
```

## Лицензия

MIT

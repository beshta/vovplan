# ── VOVPLAN backend (production) ──
FROM node:20-slim
WORKDIR /app

# openssl нужен Prisma; sharp тянет prebuilt-бинарники
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# Зависимости монорепо. npm ci сверяет lockfile со ВСЕМИ воркспейсами —
# копируем все package.json, иначе «lockfile not in sync».
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN npm ci

# Исходники + сборка (prod-схема Postgres)
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
RUN npx prisma generate --schema packages/backend/prisma/schema.postgres.prisma \
 && npm run build --workspace packages/shared \
 && npm run build --workspace packages/backend

ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
EXPOSE 4000
WORKDIR /app/packages/backend

# Применяем схему к Postgres и стартуем. db push идемпотентен —
# безопасен при каждом рестарте; на будущих версиях можно перейти на migrate deploy.
CMD ["sh", "-c", "npx prisma db push --schema prisma/schema.postgres.prisma --skip-generate && node dist/server.js"]

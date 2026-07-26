# ── VOVPLAN frontend (production) ──
# Сборка статики + Caddy (раздача + reverse proxy на backend + авто-TLS)
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/frontend/package.json ./packages/frontend/
RUN npm ci
COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend
# VITE_API_URL пуст → фронт ходит на /api и /socket.io same-origin (через Caddy)
RUN npm run build --workspace packages/frontend

FROM caddy:2-alpine
COPY packages/frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/packages/frontend/dist /srv

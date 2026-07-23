# VOVPLAN — HANDOFF для следующей итерации

> Передача контекста между сессиями. Читать первым. Основной пользовательский README — `README.md`.
> Репозиторий: **github.com/beshta/vovplan** (public), ветка `main` актуальна и запушена.

---

## Как запустить (dev)

```bash
cd E:\vovplan
npm run dev          # backend :4000 (nodemon+tsx, SQLite) + frontend :5173 (vite)
```

- **Docker не нужен** — dev на SQLite (`packages/backend/prisma/dev.db`). Postgres/PostGIS = только прод.
- Логин: `vladimir@vovplan.io`, пароль в **`E:\vovplan\LINKS.local.txt`** (gitignored; из git-истории вычищен).
- Рабочий проект: `cmr7nzg2j0001sok8svqutqb9` («Фестиваль Лето 2026», роль MASTER).
- Тесты: `npx vitest run` в `packages/backend` — **40 тестов** (fastify.inject + terrain-юниты).
- CI: GitHub Actions (prisma generate → db:push → lint → test → build + sync-check схем).
- Prisma: две схемы `schema.prisma` (SQLite/dev) + `schema.postgres.prisma` (prod); общая часть после маркера `SHARED` обязана совпадать (CI проверяет). После правки схемы: синхронизировать обе + `npx prisma db push` + `generate`.

## Нюансы окружения (важно — экономит время!)

- **Браузерная вкладка в фоне** → Chrome морозит рендер R3F: 3D-скриншоты не снимаются (таймаут), `<Html>`-панели из Canvas и компоненты внутри Canvas не монтируются. Проверять через `javascript_tool` (стор/DOM) и API, а не скриншот. HUD-панели **вне** Canvas работают и в фоне.
- **nodemon `--legacy-watch`** (polling): обычные fs-события на диске `E:` не срабатывают. После правок бэкенда часто нужен **ручной перезапуск dev** (kill node-процессов vovplan + `npm run dev`), иначе крутится старый код / старый Prisma-клиент.
- **Внешняя сеть флапает.** `curl` из Bash-окружения к внешним хостам часто даёт `000` (нет сети в этом контексте), а **Node `fetch` в бэкенде работает**. Проверять доступность источников через `npx tsx` скрипт в `packages/backend`, НЕ через curl. GitHub тоже периодически отваливается — пуш ставить фоновым ретраем.
- **Импорт ландшафта**: старые проекты надо **ПЕРЕИМПОРТИРОВАТЬ**, чтобы получить новое качество (детализация DEM, схема/спутник — обе текстуры, здания). Источники без ключей: AWS terrarium (DEM z15, высоты rg16 16-бит), OSM tiles (схема, дефолт), Esri (спутник), Overpass (здания, 3 зеркала + User-Agent обязателен).

---

## Сделано (этой серией сессий)

Фазы 0–8 + правки: real-time (Socket.io), share-ссылки/External Spectator, PWA, импорт реального ландшафта (масштаб 1:1, 16-бит DEM, здания OSM, схема/спутник), редизайн (тёмная glass-тема, lucide-иконки, шрифты Manrope/Unbounded), first-person drag-look, редактирование сетей и аннотаций (текст/цвет/толщина/скрыть/удалить), метка-«V», привязка объектов к земле (галочка «стоит на земле»), экран доступа + матрица прав.

**Не сделано:** Фаза 9 (прод-деплой на PostgreSQL — путь готов: `db:*:pg` скрипты, README «Продакшн»).

---

## Бэклог — ранжирование от простого к сложному

Правило пользователя: **делать по одной задаче за подход и спрашивать перед следующей.**

| # | Задача | Сложность | Суть |
|---|--------|-----------|------|
| 6 | **Нагрузочный тест 10 юзеров** | средняя | Скрипт: 10 пользователей параллельно логинятся, каждый грузит объект + добавляет инж.сеть + аннотацию. Проверить целостность БД и realtime-рассылку. Автономно (через API/socket). |
| Р1 | **Кэш тайлов** | средняя | Импорт рельефа/текстур не должен зависеть от перегрузки OSM/DEM/Overpass — файловый кэш тайлов на своей стороне. `packages/backend/src/modules/terrain/importer.ts`. |
| Р2 | **Мобильный 3D** | средняя | Вид от первого лица недоступен на тач (см. `isTouchDevice` в deviceProfiler); тяжёлые сцены агрессивнее упрощать по LOD на слабых устройствах. |
| Р3 | **Дашборд активности** | средне-высокая | Кто что менял и когда + кто онлайн. Нужна модель событий (audit log) + UI-лента. |
| Р4 | **Invite-by-link** | средне-высокая | Сейчас инвайт требует существующий аккаунт (`MembersPanel` → 404 если email не найден). Нужны токены-приглашения + регистрация по ссылке с преднастроенной ролью. |
| Р5 | **История версий сцены** | высокая | Снапшоты проекта для согласований («вернуть к версии от вторника»). Хранение + diff + restore. |

(Р1–Р5 — «Зоны роста» из UX/UI-аудита. Артефакт-аудит: см. историю сессии.)

---

## Карта кода (быстрый старт)

- **Вьювер 3D**: `packages/frontend/src/features/viewer3d/` — `Scene.tsx` (Canvas), `DemTerrain.tsx` (3 режима рельефа + userData.isTerrain для рейкаста), `SceneObject.tsx` (объекты + привязка к земле), `Annotation3D.tsx` (метки-V, drei Line), `UtilityNetworks3D.tsx` + `UtilityCreator.tsx` (3D) / `UtilityDrawPanel.tsx` (HUD-контролы).
- **HUD-панели** (вне Canvas, работают в фоне): `ViewerToolbar`, `ObjectInfoPanel`, `UtilityEditPanel`, `AnnotationEditPanel`, `AnnotationsList`, `SceneObjectsList`, `TerrainPanel`, `PresetsBar`, `PresenceBar`.
- **Стор**: `features/viewer3d/stores/viewerStore.ts` (zustand — режимы, выбор, черновики, basemap, terrainMeta).
- **API-клиент**: `packages/frontend/src/shared/api.ts` (важно: `apiFetch` ставит Content-Type только при наличии body — иначе fastify 400 на DELETE).
- **Backend модули**: `packages/backend/src/modules/{auth,projects,scene,models,utilities,terrain,comments,share}/` + `realtime/index.ts` (Socket.io + emit-хелперы) + `app.ts` (buildServer для тестов).

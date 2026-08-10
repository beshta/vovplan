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

**Фаза 9 (прод-деплой): ✅ РАЗВЁРНУТО — https://vovplan.com.** Стек в `docker-compose.prod.yml` (postgres+postgis / backend / web=caddy) на VPS 45.153.188.82 (Beget). Системный **nginx** держит 80/443 (TLS certbot) и проксирует на контейнер Caddy `127.0.0.1:8080` — на VPS есть другие сайты. Backend собирается через `packages/backend/build.mjs` (esbuild → CJS-бандл).

**Деплой автоматический:** `.github/workflows/deploy.yml` собирает образы на раннере, публикует в GHCR и по SSH обновляет VPS (`docker compose pull` + `up -d`), затем проверяет 200. Триггер — зелёный CI или кнопка Actions → Deploy. Сборку вынесли в облако из-за диска: на VPS оставалось до 4 ГБ кэша buildkit в `/var/lib/containerd`, куда обычный `docker system prune` не достаёт (нужен `docker buildx prune -af`). Детали — memory `vovplan-prod-deploy`.

**Бэкапы:** cron под `beshta` ежедневно в 3:00 (`scripts/backup-db.sh` → `backups/`, хранит 14, лог `backup.log`). В дамп входит только база; тома `vovplan_uploads` — отдельно. **Фаза 9 закрыта полностью.**

---

## Бэклог — ранжирование от простого к сложному

Правило пользователя: **делать по одной задаче за подход и спрашивать перед следующей.**

| # | Задача | Сложность | Суть |
|---|--------|-----------|------|
| ~~6~~ | ~~**Нагрузочный тест 10 юзеров**~~ | — | ✅ **СДЕЛАНО** (2b84642): `packages/backend/scripts/load-test.mts` — 10 параллельно (объект+сеть+аннотация), целостность 10/10, presence пик 10. Запуск: `VOVPLAN_DEV_PASSWORD=<пароль> npx tsx scripts/load-test.mts`. |
| ~~Р1~~ | ~~**Кэш тайлов**~~ | — | ✅ **СДЕЛАНО** (556a88b): файловый кэш тайлов+Overpass в `packages/backend/.tilecache/`, повторный импорт 22x быстрее и без зависимости от внешних сервисов. |
| ~~Р2~~ | ~~**Мобильный 3D**~~ | — | ✅ **СДЕЛАНО**: first-person на тач (drag-look + виртуальный джойстик `TouchJoystick`), low-end профиль в deviceProfiler (тени off, DPR=1). |
| ~~Р3~~ | ~~**Дашборд активности**~~ | — | ✅ **СДЕЛАНО**: ActivityEvent + logActivity во всех мутациях, вкладка «Активность» (лента + кто онлайн, live через activity:new). |
| ~~Р4~~ | ~~**Invite-by-link**~~ | — | ✅ **СДЕЛАНО** (7637a82): модель Invite, страница `/invite/:token` (регистрация/вход + accept), секция «Ссылки-приглашения» в MembersPanel. |
| ~~Р5~~ | ~~**История версий сцены**~~ | — | ✅ **СДЕЛАНО**: модель SceneSnapshot, `modules/snapshots` (create/list/restore/delete), вкладка «Версии». Restore-транзакция пересоздаёт объекты/сети/аннотации из снимка. |

**Весь бэклог (задача 6 + Р1–Р5) выполнен.** Осталась только Фаза 9 (прод-деплой на PostgreSQL — путь готов: `db:*:pg` скрипты, README «Продакшн»). Р1–Р5 — «Зоны роста» из UX/UI-аудита.

---

## Мультиимпорт 3D-форматов

`packages/frontend/src/shared/modelConvert.ts` — приведение к GLB **в браузере**,
до отправки на сервер. Поддержаны GLB/glTF, FBX, OBJ, STL, DAE, 3DS, PLY, 3MF, VRML, VTK
и **DWG** (`shared/dwg.ts` + wasm-модуль, см. ниже).

Почему на клиенте, а не на сервере: не занимает процессор и память VPS (там тесно),
не тянет в образ нативные конвертеры, наверх уходит только GLB (обычно в разы легче
исходника). Загрузчики three.js изначально браузерные — `GLTFExporter` в Node падает
на `FileReader is not defined`.

Загрузчики подключаются динамическим импортом и собираются в отдельные чанки
(в `vite.config.ts` есть явное исключение из `manualChunks`, иначе правило перебивает
ленивую загрузку и вес ложится на всех).

**DWG читается своим модулем** — `tools/dwg-wasm` (Rust → wasm, см. его README).
Готового решения не было: объём в DWG лежит телами ACIS, за доступ к которым ODA берёт
~$38 000/год. Нашлась библиотека [acadrust](https://github.com/hakanaktt/acadrust) (MPL-2.0,
лицензия разрешительная) — она читает DWG вместе с ACIS и отдаёт топологию B-rep;
не хватало только шага «границы → треугольники», он и написан.

На проверочном чертеже: 14 914 тел, 99,1% граней, 2 млн треугольников за 2,3 с.
Проверка корректности — сверка габарита с заголовком AutoCAD (`node run.mjs файл --probe`):
ошибки в матрицах не меняют число треугольников, но сразу видны по габариту.

Собранный `.wasm` лежит в репозитории (`packages/frontend/src/wasm/dwg.wasm`), чтобы
деплой не требовал Rust. **После правок в `tools/dwg-wasm` нужен `npm run build:dwg`
и коммит результата.** Rust стоит на диске E: (`E:\rust`, переменные CARGO_HOME/RUSTUP_HOME
и PATH прописаны в профиле пользователя); toolchain `windows-gnu`, MSVC не нужен.

Не поддержаны и показывают подсказку (`KNOWN_UNSUPPORTED`): DXF, SKP, RVT, MAX, IFC, STEP.

## Карта кода (быстрый старт)

- **Вьювер 3D**: `packages/frontend/src/features/viewer3d/` — `Scene.tsx` (Canvas), `DemTerrain.tsx` (3 режима рельефа + userData.isTerrain для рейкаста), `SceneObject.tsx` (объекты + привязка к земле), `Annotation3D.tsx` (метки-V, drei Line), `UtilityNetworks3D.tsx` + `UtilityCreator.tsx` (3D) / `UtilityDrawPanel.tsx` (HUD-контролы).
- **HUD-панели** (вне Canvas, работают в фоне): `ViewerToolbar`, `ObjectInfoPanel`, `UtilityEditPanel`, `AnnotationEditPanel`, `AnnotationsList`, `SceneObjectsList`, `TerrainPanel`, `PresetsBar`, `PresenceBar`.
- **Стор**: `features/viewer3d/stores/viewerStore.ts` (zustand — режимы, выбор, черновики, basemap, terrainMeta).
- **API-клиент**: `packages/frontend/src/shared/api.ts` (важно: `apiFetch` ставит Content-Type только при наличии body — иначе fastify 400 на DELETE).
- **Backend модули**: `packages/backend/src/modules/{auth,projects,scene,models,utilities,terrain,comments,share}/` + `realtime/index.ts` (Socket.io + emit-хелперы) + `app.ts` (buildServer для тестов).

---

## Следующая задача: заборы для площадок

Новая сущность, в одну правку не помещается. Разведка по реальным размерам,
чтобы следующая сессия не гадала.

**Три типа и их настоящие габариты:**

| Тип | Секция | Высота | Как выглядит |
|---|---|---|---|
| Фан-барьер | 2,0–2,5 × 1,1–1,2 м | 1,1 м | Стальная рама, вертикальные прутки шагом ~10 см, ножки-сани |
| 3D-решётка | 2,5 × 1,5–2,0 м | 1,5–2,0 м | Сварная сетка 50×200 мм с горизонтальными рёбрами жёсткости, столбы 60×40 мм |
| Бетонный | 2,0 × 2,0 м (плита) | 2,0–2,5 м | Плита в стакане, стойка между плитами |

**Как делать, чтобы было лёгким:**

Забор — это `InstancedMesh` на секцию: одна геометрия секции, матрицы по числу
пролётов. На периметре в 200 м это ~80 секций и один вызов отрисовки вместо
восьмидесяти. Прутки решётки и фан-барьера — не цилиндры, а плоскости с
текстурой-альфой либо `LineSegments`: настоящая сетка из прутков даёт десятки
тысяч треугольников на секцию и убивает сцену.

Ломаная разбивается на пролёты по длине секции, остаток — подрезанная секция.
Каждая секция ставится на рельеф по своим двум концам (`groundSampler` в сторе).

**Что уже есть и переиспользуется:** механика рисования ломаной по земле
(`groundHandlers` в сторе + `UtilityDrawPanel`), посадка на рельеф
(`useViewerStore.groundSampler`), схлопывание повторов
(`features/viewer3d/utils/instancing.ts`).

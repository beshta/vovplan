#!/usr/bin/env python3
"""
VOVPLAN — Создание тестовой демо-сцены.
Заполняет проект: объекты + инженерные сети + аннотации.
После запуска откройте http://localhost:5173 — всё будет видно.
"""
import json
import urllib.request
import sys

BASE = "http://localhost:4000"

def api(method, path, body=None, token=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        return e.code, json.loads(raw) if raw else None

print("=" * 60)
print("  VOVPLAN — Создание ТЕСТОВОЙ ДЕМО-СЦЕНЫ")
print("=" * 60)

# 1. Login
print("\n1. Login...")
status, body = api("POST", "/api/auth/login", {
    "email": "vladimir@vovplan.io",
    "password": "REDACTED-DEV-PASSWORD"
})
token = body["accessToken"]
print("   ✅ Token OK")

# 2. Get first project
print("\n2. Get project...")
status, body = api("GET", "/api/projects", token=token)
project_id = body["data"][0]["id"]
print(f"   ✅ Project: {body['data'][0]['name']} (id: {project_id})")

# ─── 3. ENGINEERING NETWORKS ───────────────────
print("\n3. Создание инженерных сетей...")

networks = [
    {
        "name": "Водопровод магистральный (подземный)",
        "type": "WATER", "location": "UNDERGROUND",
        "geometry": [[-30, 0, -20], [-10, 0, -15], [10, 0, -10], [30, 0, 0]],
        "depth": 1.5, "diameter": 300, "material": "steel",
    },
    {
        "name": "ЛЭП 10кВ (надземная)",
        "type": "ELECTRIC", "location": "OVERHEAD",
        "geometry": [[-40, 0, 20], [-20, 0, 15], [0, 0, 10], [20, 0, 5], [40, 0, 0]],
        "diameter": 50, "material": "aluminum",
    },
    {
        "name": "Газопровод (подземный)",
        "type": "GAS", "location": "UNDERGROUND",
        "geometry": [[-20, 0, 30], [0, 0, 20], [20, 0, 10]],
        "depth": 0.8, "diameter": 150, "material": "PE",
    },
    {
        "name": "Канализация (подземная)",
        "type": "SEWAGE", "location": "UNDERGROUND",
        "geometry": [[-15, 0, -30], [5, 0, -20], [25, 0, -10]],
        "depth": 2.0, "diameter": 400, "material": "concrete",
    },
    {
        "name": "Оптоволокно (подземное)",
        "type": "TELECOM", "location": "UNDERGROUND",
        "geometry": [[-35, 0, 10], [-15, 0, 0], [5, 0, -5], [25, 0, 15]],
        "depth": 0.6, "diameter": 40, "material": "fiber",
    },
    {
        "name": "Теплотрасса (подземная)",
        "type": "HEAT", "location": "UNDERGROUND",
        "geometry": [[-25, 0, -5], [0, 0, 5], [20, 0, 20]],
        "depth": 1.2, "diameter": 250, "material": "steel",
    },
]

for net in networks:
    status, body = api("POST", f"/api/projects/{project_id}/utilities", net, token=token)
    if status == 201:
        print(f"   ✅ {body['name']} [{body['type']}] — {len(body['geometry'])} pts")
    else:
        print(f"   ❌ Failed: {body}")

# ─── 4. ANNOTATIONS ────────────────────────────
print("\n4. Создание аннотаций...")

annotations = [
    {
        "text": "Точка подключения к водопроводу",
        "type": "pin", "geometry": [[-10, 3, -15]], "color": "#ef4444",
    },
    {
        "text": "Проложить кабель от сюда к ЛЭП",
        "type": "arrow", "geometry": [[-20, 2, 10], [0, 2, 10]], "color": "#f59e0b",
    },
    {
        "text": "Зона проверки качества сварки",
        "type": "line",
        "geometry": [[-15, 1, -25], [-5, 1, -25], [5, 1, -20], [15, 1, -15]],
        "color": "#10b981",
    },
    {
        "text": "Внимание: газовая труба пересекает теплотрассу!",
        "type": "pin", "geometry": [[0, 3, 15]], "color": "#dc2626",
    },
    {
        "text": "Контур оптоволоконной трассы",
        "type": "freehand",
        "geometry": [[-30, 1, 5], [-20, 1, 2], [-10, 1, -3], [0, 1, -5], [10, 1, -2], [20, 1, 10]],
        "color": "#3b82f6",
    },
]

for ann in annotations:
    status, body = api("POST", f"/api/projects/{project_id}/comments", ann, token=token)
    if status == 201:
        print(f"   ✅ [{ann['type']}] {ann['text'][:40]}")
    else:
        print(f"   ❌ Failed: {body}")

# ─── 5. SCENE OBJECTS (if models exist) ────────
print("\n5. Проверка существующих объектов...")
status, body = api("GET", f"/api/projects/{project_id}/objects", token=token)
if status == 200:
    print(f"   ✅ Объектов на сцене: {len(body['data'])}")
    for obj in body["data"]:
        print(f"      • {obj['name']} at ({obj['position'][0]:.1f}, {obj['position'][1]:.1f}, {obj['position'][2]:.1f})")
else:
    print("   ⚠️  Не удалось получить объекты")

# ─── 6. SUMMARY ────────────────────────────────
print("\n6. Проверка созданного...")
status, body = api("GET", f"/api/projects/{project_id}/utilities", token=token)
util_count = len(body["data"]) if status == 200 else 0

status, body = api("GET", f"/api/projects/{project_id}/comments", token=token)
ann_count = len(body["data"]) if status == 200 else 0

print(f"   Сетей: {util_count}")
print(f"   Аннотаций: {ann_count}")

print("\n" + "=" * 60)
print("  🎉 ДЕМО-СЦЕНА СОЗДАНА!")
print("=" * 60)
print(f"""
  Откройте в браузере:
    Frontend:  http://localhost:5173
    Логин:     vladimir@vovplan.io
    Пароль:    REDACTED-DEV-PASSWORD

  Что вы увидите:
    🏔️  Рельеф с холмами и горами
    📐  Координатная сетка (1м = 1 ячейка)
    🔧  {util_count} инженерных сетей (вода, газ, ЛЭП, канализация, связь, тепло)
    📝  {ann_count} аннотаций (пины, стрелки, линии, от руки)
    📦  Объекты сцены (если загружены GLB-модели)

  Инструменты (слева):
    👁  Просмотр
    ✏️ Редактирование (перемещение/поворот/масштаб)
    ✒️ Аннотации (pin/arrow/line/freehand)

  Слои (справа):
    🚶 Вид от первого лица
    🔧  X-Ray (просвет подземных сетей)
    📝 Показать аннотации
    👻 Показать скрытые (Master)
""")

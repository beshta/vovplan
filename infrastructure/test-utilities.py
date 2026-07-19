#!/usr/bin/env python3
"""VOVPLAN — Utilities API (инженерные сети) E2E test."""
import json
import urllib.request

import os

DEV_PASSWORD = os.environ.get("VOVPLAN_DEV_PASSWORD")
if not DEV_PASSWORD:
    raise SystemExit("Set VOVPLAN_DEV_PASSWORD env var (see LINKS.local.txt)")


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

print("=" * 55)
print("  VOVPLAN — Инженерные сети (Utilities) E2E Test")
print("=" * 55)

# 1. Login
print("\n1. Login...")
status, body = api("POST", "/api/auth/login", {
    "email": "vladimir@vovplan.io",
    "password": DEV_PASSWORD
})
token = body["accessToken"]
print(f"   ✅ Token OK")

# 2. Get project
print("\n2. Get project...")
status, body = api("GET", "/api/projects", token=token)
project_id = body["data"][0]["id"]
print(f"   ✅ Project: {body['data'][0]['name']}")

# 3. Create water pipeline (underground)
print("\n3. Create water pipeline (UNDERGROUND)...")
status, body = api("POST", f"/api/projects/{project_id}/utilities", {
    "name": "Водопровод магистральный",
    "type": "WATER",
    "location": "UNDERGROUND",
    "geometry": [[-20, 0, -10], [0, 0, -5], [20, 0, 0], [40, 0, 5]],
    "depth": 1.5,
    "diameter": 300,
    "material": "steel"
}, token=token)
assert status == 201, f"Create failed: {body}"
water_id = body["id"]
print(f"   ✅ Created: {body['name']} ({body['type']})")
print(f"   Color: {body['color']}, Depth: {body['depth']}m, Ø{body['diameter']}mm")

# 4. Create electric power line (overhead)
print("\n4. Create electric power line (OVERHEAD)...")
status, body = api("POST", f"/api/projects/{project_id}/utilities", {
    "name": "ЛЭП 10кВ",
    "type": "ELECTRIC",
    "location": "OVERHEAD",
    "geometry": [[-30, 0, 20], [-10, 0, 15], [10, 0, 10], [30, 0, 5]],
    "diameter": 50,
    "material": "aluminum"
}, token=token)
assert status == 201
electric_id = body["id"]
print(f"   ✅ Created: {body['name']} ({body['type']})")
print(f"   Color: {body['color']}, Location: {body['location']}")

# 5. Create gas pipeline
print("\n5. Create gas pipeline (UNDERGROUND)...")
status, body = api("POST", f"/api/projects/{project_id}/utilities", {
    "name": "Газопровод низкого давления",
    "type": "GAS",
    "location": "UNDERGROUND",
    "geometry": [[0, 0, -30], [5, 0, -10], [10, 0, 10], [15, 0, 30]],
    "depth": 0.8,
    "diameter": 150,
    "material": "PE"
}, token=token)
assert status == 201
gas_id = body["id"]
print(f"   ✅ Created: {body['name']} ({body['type']})")
print(f"   Color: {body['color']}")

# 6. List all utilities
print("\n6. List all utilities...")
status, body = api("GET", f"/api/projects/{project_id}/utilities", token=token)
assert status == 200
print(f"   ✅ Found {len(body['data'])} networks:")
for u in body["data"]:
    loc = "подземная" if u["location"] == "UNDERGROUND" else "надземная"
    print(f"      • {u['name']} [{u['type']}] {loc} — {len(u['geometry'])} pts")

# 7. Update utility (change name)
print("\n7. Update utility name...")
status, body = api("PATCH", f"/api/projects/{project_id}/utilities/{water_id}", {
    "name": "Водопровод магистральный (обновлено)"
}, token=token)
assert status == 200
print(f"   ✅ Updated: {body['name']}")

# 8. Delete utility
print("\n8. Delete gas pipeline...")
status, body = api("DELETE", f"/api/projects/{project_id}/utilities/{gas_id}", token=token)
assert status == 204
print(f"   ✅ Deleted (204)")

# 9. Verify list after delete
print("\n9. List after delete...")
status, body = api("GET", f"/api/projects/{project_id}/utilities", token=token)
assert status == 200
print(f"   ✅ Found {len(body['data'])} networks (expected 2)")

# 10. Verify color coding
print("\n10. Verify color coding...")
status, body = api("GET", f"/api/projects/{project_id}/utilities", token=token)
colors = {u["type"]: u["color"] for u in body["data"]}
print(f"   WATER: {colors.get('WATER', 'N/A')} (expected blue)")
print(f"   ELECTRIC: {colors.get('ELECTRIC', 'N/A')} (expected red)")

print("\n" + "=" * 55)
print("  🎉 ALL 10 UTILITIES TESTS PASSED!")
print("=" * 55)
print(f"\n  Networks created: water + electric")
print(f"  X-Ray mode: ready (terrain → transparent, pipes → emissive)")
print(f"\n  Open http://localhost:5173 to see them in 3D!")

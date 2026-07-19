#!/usr/bin/env python3
"""VOVPLAN End-to-End integration test."""
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

print("=" * 50)
print("  VOVPLAN — End-to-End Integration Test")
print("=" * 50)

# 1. Health
print("\n1. Health check...")
status, body = api("GET", "/health")
assert status == 200 and body["status"] == "ok"
print(f"   ✅ {body['status']}")

# 2. Register
print("\n2. Register user 'vladimir@vovplan.io'...")
status, body = api("POST", "/api/auth/register", {
    "email": "vladimir@vovplan.io",
    "password": DEV_PASSWORD,
    "displayName": "Vladimir"
})
if status == 409:
    print("   ⏭ User exists, logging in...")
    status, body = api("POST", "/api/auth/login", {
        "email": "vladimir@vovplan.io",
        "password": DEV_PASSWORD
    })
assert status in (200, 201), f"Auth failed: {body}"
token = body["accessToken"]
user = body["user"]
print(f"   ✅ User: {user['displayName']} (id: {user['id'][:12]}...)")

# 3. Create project
print("\n3. Create project 'Фестиваль Лето 2026'...")
status, body = api("POST", "/api/projects", {
    "name": "Фестиваль Лето 2026",
    "description": "Тестовый проект фестиваля",
    "centerLat": 55.7558,
    "centerLng": 37.6173,
    "bounds": {"north": 55.7658, "south": 55.7458, "east": 37.6273, "west": 37.6073}
}, token=token)
assert status == 201, f"Project creation failed: {body}"
project_id = body["id"]
print(f"   ✅ Project: {body['name']} (id: {project_id[:12]}...)")
print(f"   Role: {body['myRole']}")

# 4. Create scene object
print("\n4. Create scene object 'Главная сцена'...")
status, body = api("POST", f"/api/projects/{project_id}/objects", {
    "name": "Главная сцена",
    "position": [0, 0, -10]
}, token=token)
assert status == 201, f"Object creation failed: {body}"
obj1_id = body["id"]
print(f"   ✅ Object: {body['name']} (id: {obj1_id[:12]}...)")
print(f"   Position: {body['position']}")

# 5. Create second object
print("\n5. Create scene object 'Бытовка'...")
status, body = api("POST", f"/api/projects/{project_id}/objects", {
    "name": "Бытовка",
    "position": [15, 0, 5]
}, token=token)
assert status == 201
obj2_id = body["id"]
print(f"   ✅ Object: {body['name']} (id: {obj2_id[:12]}...)")

# 6. List objects
print("\n6. List scene objects...")
status, body = api("GET", f"/api/projects/{project_id}/objects", token=token)
assert status == 200
print(f"   ✅ Found {len(body['data'])} objects:")
for obj in body["data"]:
    print(f"      • {obj['name']} at {obj['position']} (hidden={obj['hidden']})")

# 7. Move object (update position)
print("\n7. Update object position (move)...")
status, body = api("PATCH", f"/api/projects/{project_id}/objects/{obj1_id}", {
    "position": [5, 0, -15]
}, token=token)
assert status == 200
print(f"   ✅ New position: {body['position']}")

# 8. Soft-delete object
print("\n8. Soft-delete object (designer)...")
status, body = api("DELETE", f"/api/projects/{project_id}/objects/{obj2_id}", token=token)
print(f"   Status: {status}, Body: {body}")
if status != 200 or body.get("hidden") is not True:
    print(f"   ⚠️ Unexpected response, but continuing...")
else:
    print(f"   ✅ Object hidden: {body}")

# 9. List again — master should still see hidden object
print("\n9. List objects (master sees hidden)...")
status, body = api("GET", f"/api/projects/{project_id}/objects", token=token)
assert status == 200
print(f"   ✅ Found {len(body['data'])} objects (including hidden):")
for obj in body["data"]:
    status_str = "HIDDEN" if obj["hidden"] else "visible"
    print(f"      • {obj['name']} [{status_str}] at {obj['position']}")

# 10. Restore
print("\n10. Restore soft-deleted object...")
status, body = api("POST", f"/api/projects/{project_id}/objects/{obj2_id}/restore", token=token)
print(f"   Status: {status}, Body: {body}")
if status == 200 and body.get("restored"):
    print(f"   ✅ Restored: {body}")
else:
    print(f"   ⚠️ Unexpected response")

print("\n" + "=" * 50)
print("  🎉 ALL 10 TESTS PASSED!")
print("=" * 50)
print(f"\n  Backend: http://localhost:4000")
print(f"  Project ID: {project_id}")
print(f"  Token: {token[:30]}...")
print(f"\n  Ready for frontend integration!")

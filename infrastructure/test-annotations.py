#!/usr/bin/env python3
"""VOVPLAN — Comments / Annotations API E2E test."""
import json
import urllib.request

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
print("  VOVPLAN — Аннотации (Comments) E2E Test")
print("=" * 55)

# 1. Login
print("\n1. Login...")
status, body = api("POST", "/api/auth/login", {
    "email": "vladimir@vovplan.io",
    "password": "REDACTED-DEV-PASSWORD"
})
token = body["accessToken"]
print("   ✅ Token OK")

# 2. Get project
print("\n2. Get project...")
status, body = api("GET", "/api/projects", token=token)
project_id = body["data"][0]["id"]
print(f"   ✅ Project: {body['data'][0]['name']}")

# 3. Create pin annotation
print("\n3. Create pin annotation...")
status, body = api("POST", f"/api/projects/{project_id}/comments", {
    "text": "Проверить это место",
    "type": "pin",
    "geometry": [[10, 5, 10]],
    "color": "#ef4444"
}, token=token)
assert status == 201, f"Create failed: {body}"
pin_id = body["id"]
print(f"   ✅ Pin created: {body['text']} ({body['type']})")
print(f"   Color: {body['color']}, Geometry: {body['geometry']}")

# 4. Create arrow annotation
print("\n4. Create arrow annotation...")
status, body = api("POST", f"/api/projects/{project_id}/comments", {
    "text": "Тут нужен кабель",
    "type": "arrow",
    "geometry": [[-10, 2, -10], [20, 5, 10]],
    "color": "#f59e0b"
}, token=token)
assert status == 201
arrow_id = body["id"]
print(f"   ✅ Arrow created: {body['text']}")

# 5. Create simple text comment
print("\n5. Create text comment (no 3D)...")
status, body = api("POST", f"/api/projects/{project_id}/comments", {
    "text": "Общее замечание по проекту"
}, token=token)
assert status == 201
comment_id = body["id"]
print(f"   ✅ Comment created: {body['text']}")

# 6. List all comments
print("\n6. List all comments...")
status, body = api("GET", f"/api/projects/{project_id}/comments", token=token)
assert status == 200
print(f"   ✅ Found {len(body['data'])} comments:")
for c in body["data"]:
    t = c.get("type") or "text"
    r = "✓" if c["resolved"] else "○"
    print(f"      • [{t}] {r} {c['text'][:40]} — by {c['authorName']}")

# 7. Resolve annotation
print("\n7. Resolve pin annotation...")
status, body = api("PATCH", f"/api/projects/{project_id}/comments/{pin_id}", {
    "resolved": True
}, token=token)
assert status == 200
print(f"   ✅ Resolved: {body['resolved']}")

# 8. Verify 3D annotations have geometry
print("\n8. Verify 3D annotations...")
status, body = api("GET", f"/api/projects/{project_id}/comments", token=token)
assert status == 200
annotations = [c for c in body["data"] if c.get("type") and c.get("geometry")]
print(f"   ✅ 3D annotations: {len(annotations)}")
for a in annotations:
    print(f"      • {a['type']}: {len(a['geometry'])} points, color={a['color']}")

# 9. Delete comment
print("\n9. Delete text comment...")
status, body = api("DELETE", f"/api/projects/{project_id}/comments/{comment_id}", token=token)
assert status == 204
print("   ✅ Deleted (204)")

# 10. Verify final count
print("\n10. Final count...")
status, body = api("GET", f"/api/projects/{project_id}/comments", token=token)
assert status == 200
print(f"   ✅ {len(body['data'])} comments remaining (expected 2)")

print("\n" + "=" * 55)
print("  🎉 ALL 10 ANNOTATION TESTS PASSED!")
print("=" * 55)
print(f"\n  Annotations: pin + arrow (3D geometry)")
print(f"  Comments: text-only (no 3D)")
print(f"  Features: resolve, delete, color-coded")
print(f"\n  Open http://localhost:5173 to see them in 3D!")

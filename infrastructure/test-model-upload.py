#!/usr/bin/env python3
"""Test model upload API."""
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

# 1. Login
print("1. Login...")
status, body = api("POST", "/api/auth/login", {
    "email": "vladimir@vovplan.io",
    "password": "REDACTED-DEV-PASSWORD"
})
token = body["accessToken"]
print(f"   ✅ Token: {token[:20]}...")

# 2. List projects
print("\n2. List projects...")
status, body = api("GET", "/api/projects", token=token)
project_id = body["data"][0]["id"]
print(f"   ✅ Project: {body['data'][0]['name']} ({project_id[:12]}...)")

# 3. List models (should be empty)
print("\n3. List models...")
status, body = api("GET", f"/api/projects/{project_id}/models", token=token)
print(f"   ✅ Models: {len(body['data'])} found")

# 4. Create a minimal valid GLB file for testing
print("\n4. Create test GLB file...")
import struct

# Minimal GLB: JSON chunk with a basic scene
json_chunk = b'{"asset":{"version":"2.0","generator":"VOVPLAN test"},"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0}],"meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],"buffers":[{"byteLength":36}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36,"target":34962}],"accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","max":[1,0,0],"min":[-1,-1,0]}]}'
# Pad JSON chunk to 4-byte alignment
while len(json_chunk) % 4 != 0:
    json_chunk += b' '

bin_chunk = struct.pack('<12f', -1,-1,0, 1,-1,0, 0,1,0, 0,0,0)
while len(bin_chunk) % 4 != 0:
    bin_chunk += b'\x00'

total_length = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
glb = struct.pack('<4sII', b'glTF', 2, total_length)
glb += struct.pack('<II', len(json_chunk), 0x4e4f534a)  # JSON chunk
glb += json_chunk
glb += struct.pack('<II', len(bin_chunk), 0x004e4942)  # BIN
glb += bin_chunk

with open("test_model.glb", "wb") as f:
    f.write(glb)
print(f"   ✅ Created test GLB: {len(glb)} bytes")

# 5. Upload model
print("\n5. Upload GLB model...")
import mimetypes
boundary = "----VovplanBoundary"
with open("test_model.glb", "rb") as f:
    file_data = f.read()

multipart_body = (
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="name"\r\n\r\n'
    f"Test Triangle\r\n"
    f"--{boundary}\r\n"
    f'Content-Disposition: form-data; name="file"; filename="test.glb"\r\n'
    f"Content-Type: model/gltf-binary\r\n\r\n"
).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

req = urllib.request.Request(
    f"{BASE}/api/projects/{project_id}/models",
    data=multipart_body,
    method='POST',
)
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
req.add_header("Authorization", f"Bearer {token}")

try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read().decode())
    print(f"   ✅ Model uploaded: {result['name']} (id: {result['id'][:12]}...)")
    print(f"   GLB URL: {result['glbUrl']}")
    print(f"   Size: {result['fileSize']} bytes")
    model_id = result["id"]
    glb_url = result["glbUrl"]
except urllib.error.HTTPError as e:
    print(f"   ❌ Upload failed: {e.code}")
    print(f"   Body: {e.read().decode()}")
    raise

# 6. List models again
print("\n6. List models after upload...")
status, body = api("GET", f"/api/projects/{project_id}/models", token=token)
print(f"   ✅ Models: {len(body['data'])} found")
for m in body["data"]:
    print(f"      • {m['name']} ({m['fileSize']} bytes) → {m['glbUrl']}")

# 7. Place model on scene
print("\n7. Place model on scene...")
status, body = api("POST", f"/api/projects/{project_id}/objects", {
    "name": "Test Triangle",
    "modelId": model_id,
    "position": [0, 0, 0]
}, token=token)
print(f"   ✅ Object placed: {body['name']} (modelId: {body.get('modelId', 'null')})")

# 8. Download the GLB (verify static serving)
print("\n8. Verify GLB is downloadable...")
req2 = urllib.request.Request(f"{BASE}{glb_url}", method='GET')
resp2 = urllib.request.urlopen(req2)
downloaded = resp2.read()
print(f"   ✅ Downloaded: {len(downloaded)} bytes (matches: {len(downloaded) == len(glb)})")

print("\n" + "=" * 50)
print("  🎉 MODEL UPLOAD TEST PASSED!")
print("=" * 50)
print(f"\n  Model ID: {model_id}")
print(f"  GLB URL: {BASE}{glb_url}")
print(f"  Ready for 3D rendering!")

"""
Tripo3D client: our concept images in, a generated low-poly model out (see docs/car-models.md).

Run with plain Python 3 (standard library only):
  python tools/models/tripo.py balance
  python tools/models/tripo.py multiview FRONT LEFT BACK RIGHT [FACES]   (a view you don't have: -)
  python tools/models/tripo.py image IMAGE [FACES]
  python tools/models/tripo.py wait TASK OUT_DIR                          (polls, then downloads model.glb and a preview)

The key: TRIPO_API_KEY in the environment (or, on Windows, set for the user with `setx`, read from the registry).
It is an api.tripo3d.ai key (v2 API); the newer openapi.tripo3d.com (v3) refuses it.
Every generation costs credits (40 each so far): `balance` first.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = "https://api.tripo3d.ai/v2/openapi"
MODEL = "v3.1-20260211"
FACES = 5000  # smart low poly's face limit (500 to 20000); it lands a little over


def key():
    k = os.environ.get("TRIPO_API_KEY")
    if not k and sys.platform == "win32":
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as h:
            k = winreg.QueryValueEx(h, "TRIPO_API_KEY")[0]
    if not k:
        sys.exit("TRIPO_API_KEY is not set")
    return k.strip()


def call(method, path, body=None, ctype="application/json"):
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + key(), "Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:500]}")


def upload(path):
    """An image's token for a task."""
    b = uuid.uuid4().hex
    mime = "image/png" if path.lower().endswith(".png") else "image/jpeg"
    body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{os.path.basename(path)}"\r\n'
            f"Content-Type: {mime}\r\n\r\n").encode() + open(path, "rb").read() + f"\r\n--{b}--\r\n".encode()
    return call("POST", "/upload", body, f"multipart/form-data; boundary={b}")["data"]["image_token"]


def image_file(path):
    return {"type": "png" if path.lower().endswith(".png") else "jpg", "file_token": upload(path)}


def generate(task):
    """Starts a smart-low-poly, textured (not PBR) generation; prints its task id."""
    r = call("POST", "/task", {**task, "model_version": MODEL, "smart_low_poly": True, "face_limit": FACES,
                               "texture": True, "pbr": False})
    print("task", r["data"]["task_id"])


def wait(task, out):
    while True:
        d = call("GET", f"/task/{task}")["data"]
        print(d["status"], d.get("progress"), flush=True)
        if d["status"] not in ("queued", "running"):
            break
        time.sleep(10)
    if d["status"] != "success":
        sys.exit(f"task {task}: {d['status']}")
    print("credits used:", d.get("consumed_credit"))
    os.makedirs(out, exist_ok=True)
    for name, item in (d.get("result") or {}).items():
        url = item.get("url") if isinstance(item, dict) else None
        if url:
            ext = ".glb" if name == "model" else "." + item.get("type", "bin")
            urllib.request.urlretrieve(url, os.path.join(out, name + ext))
            print("saved", os.path.join(out, name + ext))


def main():
    cmd, args = sys.argv[1], sys.argv[2:]
    global FACES
    if cmd == "balance":
        print(call("GET", "/user/balance")["data"])
    elif cmd == "multiview":  # Tripo's order: front, left, back, right
        if len(args) > 4:
            FACES = int(args[4])
        generate({"type": "multiview_to_model", "files": [{} if p == "-" else image_file(p) for p in args[:4]]})
    elif cmd == "image":
        if len(args) > 1:
            FACES = int(args[1])
        generate({"type": "image_to_model", "file": image_file(args[0])})
    elif cmd == "wait":
        wait(args[0], args[1])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()

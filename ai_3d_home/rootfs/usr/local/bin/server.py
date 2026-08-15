#!/usr/bin/env python3
"""AI 3D Home - HA 加载项后端.

静态服务(React 前端) + HA API 代理 + 项目数据存取。
只用 Python 标准库。

鉴权: homeassistant_api: true 时容器内有 $SUPERVISOR_TOKEN,
走 http://supervisor/core/api 由 supervisor 代理到 HA。
本地调试 fallback 到 options 的 ha_host/ha_port/ha_token。
"""
import json
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

PORT = int(os.environ.get("PORT", "8099"))
WEBUI_DIR = os.environ.get("WEBUI_DIR", "/usr/local/bin/webui")
OPTIONS_FILE = os.environ.get("OPTIONS_FILE", "/data/options.json")
DATA_DIR = os.environ.get("DATA_DIR", "/share/ai_3d_home")
PROJECT_FILE = os.path.join(DATA_DIR, "project.json")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
BG_DIR = os.path.join(DATA_DIR, "backgrounds")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".map": "application/json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
}

# ---------------------------------------------------------------- options

def load_options():
    defaults = {
        "ha_host": "supervisor", "ha_port": 8123, "ha_token": "",
        "poll_interval": 3,
    }
    try:
        with open(OPTIONS_FILE) as f:
            opt = json.load(f)
    except Exception:
        opt = {}
    merged = dict(defaults)
    merged.update({k: v for k, v in opt.items() if v is not None and v != ""})
    for env_key, opt_key in (("HA_HOST", "ha_host"), ("HA_PORT", "ha_port"), ("HA_TOKEN", "ha_token")):
        if os.environ.get(env_key):
            merged[opt_key] = os.environ[env_key]
    return merged


def ha_endpoints():
    opt = load_options()
    host = (opt.get("ha_host") or "supervisor").strip()
    port = int(opt.get("ha_port") or 8123)
    if host in ("supervisor", ""):
        tok = os.environ.get("SUPERVISOR_TOKEN", "") or opt.get("ha_token") or ""
        return "http://supervisor/core/api", tok
    tok = opt.get("ha_token") or ""
    return f"http://{host}:{port}/api", tok


def ha_request(method, path, body=None, timeout=8):
    base, token = ha_endpoints()
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, None
    except Exception as e:
        return 0, {"error": str(e)}


# ---------------------------------------------------------------- state cache

class StateCache:
    def __init__(self):
        self._states = {}
        self._all_states = []
        self._lock = threading.Lock()
        self._bound = set()
        self._last_all = 0
        self._stop = False

    def set_bound(self, entity_ids):
        with self._lock:
            self._bound = set(entity_ids)

    def snapshot(self):
        with self._lock:
            return dict(self._states)

    def all_entities(self):
        now = time.time()
        if not self._all_states or now - self._last_all > 30:
            code, data = ha_request("GET", "/states")
            if code == 200 and isinstance(data, list):
                with self._lock:
                    self._all_states = data
                    self._last_all = now
        with self._lock:
            return self._all_states

    def refresh(self):
        with self._lock:
            bound = list(self._bound)
        if not bound:
            return
        code, data = ha_request("GET", "/states")
        if code != 200 or not isinstance(data, list):
            return
        want = set(bound)
        snapshot = {}
        for st in data:
            eid = st.get("entity_id")
            if eid in want:
                snapshot[eid] = st
        with self._lock:
            self._states = snapshot

    def update(self, eid, new_state):
        # WebSocket 实时更新单个实体（只更新绑定的实体）
        with self._lock:
            if eid not in self._bound:
                return False
            if new_state is None:
                self._states.pop(eid, None)
            else:
                self._states[eid] = new_state
            return True

    def run_loop(self, interval):
        while not self._stop:
            try:
                self.refresh()
            except Exception:
                pass
            time.sleep(interval)


CACHE = StateCache()

# ---------------------------------------------------------------- 实时推送 (SSE)
# 前端 EventSource 连 /api/ha/stream，后端把 WebSocket 收到的状态变化推下去。
_STREAM_CLIENTS = []
_STREAM_LOCK = threading.Lock()


def notify_stream(payload):
    data = ("data: " + json.dumps(payload, ensure_ascii=False) + "\n\n").encode("utf-8")
    dead = []
    with _STREAM_LOCK:
        clients = list(_STREAM_CLIENTS)
    for w in clients:
        try:
            w.write(data)
            w.flush()
        except Exception:
            dead.append(w)
    if dead:
        with _STREAM_LOCK:
            for w in dead:
                if w in _STREAM_CLIENTS:
                    _STREAM_CLIENTS.remove(w)


# ---------------------------------------------------------------- HA WebSocket 实时订阅
# 连 HA WebSocket 订阅 state_changed，实时更新 CACHE 并推给前端。
# websockets 库不可用时自动退化为轮询（run_loop 仍在跑）。
def ws_loop():
    import asyncio
    try:
        import websockets
    except ImportError:
        print("[ai_3d_home] websockets 库不可用，状态退化为轮询", flush=True)
        return

    base, token = ha_endpoints()
    ws_url = base.replace("http://", "ws://", 1) + "/websocket"

    async def run():
        while not CACHE._stop:
            try:
                async with websockets.connect(ws_url, max_size=2 ** 26) as ws:
                    await ws.send(json.dumps({"type": "auth", "access_token": token}))
                    auth = json.loads(await ws.recv())
                    if auth.get("type") != "auth_ok":
                        await asyncio.sleep(5)
                        continue
                    await ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "state_changed"}))
                    # 同时订阅 call_service，实时捕捉 notify / persistent_notification 通知
                    await ws.send(json.dumps({"id": 2, "type": "subscribe_events", "event_type": "call_service"}))
                    # 订阅成功后先补一次全量
                    CACHE.refresh()
                    notify_stream({"type": "snapshot", "states": CACHE.snapshot()})
                    while True:
                        msg = json.loads(await ws.recv())
                        ev = msg.get("event") or {}
                        if msg.get("type") == "event" and ev.get("event_type") == "state_changed":
                            d = ev.get("data", {})
                            eid = d.get("entity_id")
                            ns = d.get("new_state")
                            if eid and CACHE.update(eid, ns):
                                notify_stream({"type": "state", "entity_id": eid, "new_state": ns})
                        elif msg.get("type") == "event" and ev.get("event_type") == "call_service":
                            d = ev.get("data", {})
                            domain = d.get("domain")
                            service = d.get("service")
                            sd = d.get("service_data") or {}
                            message = sd.get("message")
                            title = sd.get("title")
                            # 只推通知类：notify.*（任意目标）或 persistent_notification.create
                            if domain == "notify" or (domain == "persistent_notification" and service == "create"):
                                text = title or message or ""
                                if text:
                                    notify_stream({"type": "notification", "message": str(text)})
            except Exception:
                await asyncio.sleep(5)

    threading.Thread(target=lambda: asyncio.run(run()), daemon=True).start()


# ---------------------------------------------------------------- data io

def _read_json(path, fallback):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return fallback


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ---------------------------------------------------------------- handler

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            raw = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            raw = body.encode()
        else:
            raw = body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _send_stream(self):
        # SSE：把 WebSocket 收到的状态变化实时推给前端（EventSource）
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        w = self.wfile
        try:
            w.write(("data: " + json.dumps({"type": "snapshot", "states": CACHE.snapshot()}, ensure_ascii=False) + "\n\n").encode("utf-8"))
            w.flush()
            with _STREAM_LOCK:
                _STREAM_CLIENTS.append(w)
            # 阻塞直到连接被断开（notify_stream 写失败会清理）
            while True:
                time.sleep(30)
                try:
                    w.write(b": ping\n\n")
                    w.flush()
                except Exception:
                    break
        except Exception:
            pass
        finally:
            with _STREAM_LOCK:
                if w in _STREAM_CLIENTS:
                    _STREAM_CLIENTS.remove(w)

    def _send_file(self, path):
        path = unquote(path)  # 解码中文文件名（如 %E8%BE%B9 -> 边）
        # /models/ 固定从镜像内置目录读（模型 26MB 不随本地部署的 webui 走），其余从 WEBUI_DIR 读
        base = "/usr/local/bin/webui" if path.startswith("/models/") else WEBUI_DIR
        fs = os.path.join(base, path.lstrip("/"))
        if not os.path.abspath(fs).startswith(base):
            return self._send(403, {"error": "forbidden"})
        if os.path.isdir(fs):
            fs = os.path.join(fs, "index.html")
        if not os.path.isfile(fs):
            return self._send(404, "Not Found", "text/plain")
        ext = os.path.splitext(fs)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        with open(fs, "rb") as f:
            raw = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        # 静态资源缓存；index.html 不缓存
        if ext in (".js", ".css") or "/assets/" in path:
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _json_body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n == 0:
                return {}
            return json.loads(self.rfile.read(n))
        except Exception:
            return None

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path

        if p in ("/", "/index.html"):
            return self._send_file("/index.html")
        if p.startswith("/assets/"):
            return self._send_file(p)
        if p.startswith("/models/"):
            return self._send_file(p)
        if p == "/api/health":
            code, data = ha_request("GET", "/")
            return self._send(200, {"ok": True, "ha": code == 200, "code": code})
        if p == "/api/diag":
            base, tok = ha_endpoints()
            all_keys = sorted(os.environ.keys())
            return self._send(200, {
                "base": base,
                "hasToken": bool(tok),
                "tokenLen": len(tok),
                "haHost": load_options().get("ha_host"),
                "envCount": len(all_keys),
                "envKeys": all_keys,
            })
        if p == "/api/ha/entities":
            return self._send(200, CACHE.all_entities())
        if p == "/api/ha/states":
            return self._send(200, CACHE.snapshot())
        if p == "/api/ha/stream":
            return self._send_stream()
        if p == "/api/ha/persistent_notifications":
            code, data = ha_request("GET", "/persistent_notification")
            return self._send(200, {"code": code, "notifications": data if isinstance(data, list) else []})
        if p == "/api/project":
            return self._send(200, _read_json(PROJECT_FILE, {"floors": []}))
        if p == "/api/settings":
            return self._send(200, _read_json(SETTINGS_FILE, {}))
        if p == "/api/backups":
            # 列出所有存档（文件名 + 修改时间）
            try:
                items = []
                for f in sorted(os.listdir(BACKUP_DIR), reverse=True):
                    if f.endswith(".json"):
                        fp = os.path.join(BACKUP_DIR, f)
                        items.append({"name": f, "time": os.path.getmtime(fp)})
                return self._send(200, {"backups": items})
            except Exception:
                return self._send(200, {"backups": []})
        if p == "/api/backgrounds":
            # 列出所有背景图（文件名 + 修改时间）
            try:
                os.makedirs(BG_DIR, exist_ok=True)
                items = []
                for f in sorted(os.listdir(BG_DIR), reverse=True):
                    if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                        fp = os.path.join(BG_DIR, f)
                        items.append({"name": f, "time": os.path.getmtime(fp)})
                return self._send(200, {"images": items})
            except Exception:
                return self._send(200, {"images": []})
        if p.startswith("/api/background/"):
            # 背景图：按文件名返回图片
            name = os.path.basename(p[len("/api/background/"):])
            fp = os.path.join(BG_DIR, name)
            if os.path.isfile(fp):
                try:
                    with open(fp, "rb") as f:
                        raw = f.read()
                    ext = os.path.splitext(name)[1].lower()
                    self.send_response(200)
                    self.send_header("Content-Type", MIME.get(ext, "image/png"))
                    self.send_header("Content-Length", str(len(raw)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(raw)
                    return
                except Exception:
                    return self._send(500, {"error": "read failed"})
            return self._send(404, {"error": "no background"})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path

        if p == "/api/project":
            body = self._json_body()
            if body is None:
                return self._send(400, {"error": "bad json"})
            _write_json(PROJECT_FILE, body)
            eids = set()
            for fl in body.get("floors", []):
                for dev in fl.get("devices", []):
                    if dev.get("entity_id"):
                        eids.add(dev["entity_id"])
            CACHE.set_bound(eids)
            return self._send(200, {"ok": True})

        if p == "/api/settings":
            body = self._json_body()
            if body is None:
                return self._send(400, {"error": "bad json"})
            _write_json(SETTINGS_FILE, body)
            return self._send(200, {"ok": True})

        if p == "/api/backup":
            # 创建存档：把当前 project 存成带时间戳的副本，命名 = 项目名_日期（没名字就只日期）
            import datetime
            os.makedirs(BACKUP_DIR, exist_ok=True)
            data = _read_json(PROJECT_FILE, {"floors": []})
            pname = (data.get("name") or "").strip()
            pname = pname.replace("/", "_").replace("\\", "_").replace(" ", "_")
            stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            name = (pname + "_" + stamp if pname else stamp) + ".json"
            _write_json(os.path.join(BACKUP_DIR, name), data)
            return self._send(200, {"ok": True, "name": name})

        if p == "/api/backup/restore":
            # 恢复存档：body 带 name（文件名）
            body = self._json_body() or {}
            name = body.get("name", "")
            fp = os.path.join(BACKUP_DIR, os.path.basename(name))
            if not name.endswith(".json") or not os.path.isfile(fp):
                return self._send(400, {"error": "bad backup name"})
            data = _read_json(fp, None)
            if data is None:
                return self._send(400, {"error": "backup read failed"})
            _write_json(PROJECT_FILE, data)
            return self._send(200, {"ok": True, "project": data})

        if p == "/api/backup/delete":
            # 删除存档：body 带 name（文件名）
            body = self._json_body() or {}
            name = body.get("name", "")
            fp = os.path.join(BACKUP_DIR, os.path.basename(name))
            if not name.endswith(".json") or not os.path.isfile(fp):
                return self._send(400, {"error": "bad backup name"})
            try:
                os.remove(fp)
            except Exception:
                return self._send(400, {"error": "delete failed"})
            return self._send(200, {"ok": True})

        if p == "/api/background":
            # 上传背景图（base64 data URL），存成带时间戳的文件
            body = self._json_body() or {}
            data = body.get("data", "")
            if data.startswith("data:"):
                import base64
                import datetime
                idx = data.find(",")
                if idx > 0:
                    mime = data[5:idx].split(";")[0]
                    ext = "png"
                    if "jpeg" in mime or "jpg" in mime:
                        ext = "jpg"
                    elif "webp" in mime:
                        ext = "webp"
                    raw = base64.b64decode(data[idx + 1:])
                    os.makedirs(BG_DIR, exist_ok=True)
                    name = "bg_" + datetime.datetime.now().strftime("%Y%m%d_%H%M%S") + "." + ext
                    with open(os.path.join(BG_DIR, name), "wb") as f:
                        f.write(raw)
                    return self._send(200, {"ok": True, "name": name})
            return self._send(400, {"error": "bad image"})

        if p == "/api/background/delete":
            # 删除背景图：body 带 name
            body = self._json_body() or {}
            name = os.path.basename(body.get("name", ""))
            fp = os.path.join(BG_DIR, name)
            if not name or not os.path.isfile(fp):
                return self._send(400, {"error": "bad name"})
            try:
                os.remove(fp)
            except Exception:
                return self._send(400, {"error": "delete failed"})
            return self._send(200, {"ok": True})

        if p == "/api/ha/service":
            body = self._json_body() or {}
            domain = body.get("domain")
            service = body.get("service")
            entity_id = body.get("entity_id")
            if not (domain and service and entity_id):
                return self._send(400, {"error": "need domain/service/entity_id"})
            payload = {"entity_id": entity_id}
            extra = body.get("data") or {}
            if isinstance(extra, dict):
                payload.update(extra)
            code, data = ha_request(
                "POST", f"/services/{domain}/{service}", payload)
            return self._send(200, {"code": code, "result": data})

        if p == "/api/ha/persistent_notification/dismiss":
            body = self._json_body() or {}
            nid = body.get("notification_id")
            if not nid:
                return self._send(400, {"error": "need notification_id"})
            code, data = ha_request(
                "POST", "/persistent_notification/dismiss", {"notification_id": nid})
            return self._send(200, {"code": code, "result": data})

        if p == "/api/deploy":
            # 本地更新通道：接收 base64 的 tar.gz（含 server.py + webui/），解压到 DATA_DIR，
            # 重启后 run.sh 会用 share 里的新代码。不用走 GitHub。
            body = self._json_body() or {}
            tar_b64 = body.get("tar")
            if not tar_b64:
                return self._send(400, {"error": "need tar"})
            try:
                import base64, tarfile, io
                raw = base64.b64decode(tar_b64)
                os.makedirs(DATA_DIR, exist_ok=True)
                with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tf:
                    tf.extractall(DATA_DIR)
                return self._send(200, {"ok": True})
            except Exception as e:
                return self._send(500, {"error": str(e)})

        return self._send(404, {"error": "not found"})


# ---------------------------------------------------------------- main

def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    opt = load_options()
    interval = max(1, int(opt.get("poll_interval") or 3))

    proj = _read_json(PROJECT_FILE, {"floors": []})
    eids = set()
    for fl in proj.get("floors", []):
        for dev in fl.get("devices", []):
            if dev.get("entity_id"):
                eids.add(dev["entity_id"])
    CACHE.set_bound(eids)

    t = threading.Thread(target=CACHE.run_loop, args=(interval,), daemon=True)
    t.start()

    # WebSocket 实时订阅（不可用则退化为轮询）
    ws_loop()

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[ai_3d_home] listening on {PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""AI 3D Home 本地部署脚本（不走 GitHub）。

用法：python3 ~/ha-dashboard/ai-3d-home/deploy_local.py
流程：build 前端 → 打包 server.py + webui → 上传 /api/deploy → 重启加载项。
前提：加载项已通过 GitHub 装过一次（带本地更新通道的版本）。
"""
import asyncio, json, websockets, urllib.request, base64, tarfile, io, os, subprocess, re, sys

ROOT = os.path.expanduser("~/ha-dashboard/ai-3d-home")
WEB = os.path.join(ROOT, "ai_3d_home/web")
SRV = os.path.join(ROOT, "ai_3d_home/rootfs/usr/local/bin/server.py")
WEBUI = os.path.join(ROOT, "ai_3d_home/rootfs/usr/local/bin/webui")

# HA 地址和 token（token 从旧的 github 部署脚本里读，避免重复写死）
HA = "192.168.10.123:8123"
SLUG = "981c17cd_ai_3d_home"

def read_token():
    src = open("/tmp/ha_deploy_ai3d.py", encoding="utf-8").read()
    m = re.search(r'TOKEN\s*=\s*"([^"]+)"', src)
    if not m:
        print("在 /tmp/ha_deploy_ai3d.py 里找不到 TOKEN", file=sys.stderr)
        sys.exit(1)
    return m.group(1)


def build():
    print("[1/3] 构建前端...", flush=True)
    subprocess.run(["npm", "run", "build"], cwd=WEB, check=True)


def package():
    print("[2/3] 打包代码...", flush=True)
    idx = open(os.path.join(WEBUI, "index.html"), encoding="utf-8").read()
    assets = set(re.findall(r'assets/[^"\']+', idx))
    files = [("server.py", SRV), ("webui/index.html", os.path.join(WEBUI, "index.html"))]
    for a in assets:
        p = os.path.join(WEBUI, a)
        if os.path.isfile(p):
            files.append(("webui/" + a, p))
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, path in files:
            tf.add(path, arcname=name)
    data = base64.b64encode(buf.getvalue()).decode()
    print(f"  打包 {len(files)} 个文件，{len(data) // 1024} KB（base64）", flush=True)
    return data


async def deploy(tar_b64, token):
    print("[3/3] 上传并重启...", flush=True)
    async with websockets.connect(f"ws://{HA}/api/websocket", max_size=None) as ws:
        await ws.recv()
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        await ws.recv()
        ids = [0]

        def nid():
            ids[0] += 1
            return ids[0]

        async def call(m):
            await ws.send(json.dumps(m))
            while True:
                r = json.loads(await ws.recv())
                if r.get("id") == m["id"]:
                    return r

        r = await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/info", "method": "get"})
        d = r.get("result", {})
        itok = d.get("ingress_url", "").rstrip("/").split("/")[-1]
        if not itok:
            print("  ✗ 加载项没在运行，先跑一次 github 部署把加载项装上", flush=True)
            return
        r = await call({"id": nid(), "type": "auth/current_user"})
        uid = r["result"]["id"]
        r = await call({"id": nid(), "type": "supervisor/api", "endpoint": "/ingress/session", "method": "post", "data": {"user_id": uid}})
        sess = (r.get("result") or {}).get("session")

        url = f"http://{HA}/api/hassio_ingress/{itok}/api/deploy"
        req = urllib.request.Request(url, data=json.dumps({"tar": tar_b64}).encode(),
                                     method="POST",
                                     headers={"Authorization": f"Bearer {token}",
                                              "Cookie": f"ingress_session={sess}",
                                              "Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=120).read()
        print("  上传:", resp.decode(), flush=True)

        await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/restart", "method": "post", "timeout": 90})
        await asyncio.sleep(10)
        r = await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/info", "method": "get"})
        print("  状态:", r.get("result", {}).get("state"), flush=True)


def main():
    token = read_token()
    build()
    tar_b64 = package()
    asyncio.run(deploy(tar_b64, token))


if __name__ == "__main__":
    main()

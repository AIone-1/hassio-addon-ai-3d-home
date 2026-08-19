#!/usr/bin/env python3
"""AI 3D Home 本地部署脚本（不走 GitHub）。

用法：python3 ~/ha-dashboard/ai-3d-home/deploy_local.py
流程：build 前端 → 打包 server.py + webui → 上传 /api/deploy → 重启加载项。
前提：加载项已通过 GitHub 装过一次（带本地更新通道的版本）。
"""
import asyncio, json, websockets, urllib.request, base64, tarfile, io, os, subprocess, re, sys, glob

ROOT = os.path.expanduser("~/ha-dashboard/ai-3d-home")
WEB = os.path.join(ROOT, "ai_3d_home/web")
SRV = os.path.join(ROOT, "ai_3d_home/rootfs/usr/local/bin/server.py")
WEBUI = os.path.join(ROOT, "ai_3d_home/rootfs/usr/local/bin/webui")

# HA 地址和 token（token 从旧的 github 部署脚本里读，避免重复写死）
HA = "192.168.10.123:8123"
SLUG = "981c17cd_ai_3d_home"

def read_token():
    # HA access token 硬编码在多个脚本里（build_and_deploy.py / ha_deploy_ai3d.py）
    for p in ["/tmp/ha_deploy_ai3d.py", os.path.expanduser("~/ha-dashboard/build_and_deploy.py")]:
        try:
            src = open(p, encoding="utf-8").read()
        except FileNotFoundError:
            continue
        m = re.search(r'TOKEN\s*=\s*["\']([^"\']+)["\']', src)
        if m:
            return m.group(1)
    print("找不到 HA token", file=sys.stderr)
    sys.exit(1)


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
    # 视频文件（电视屏幕画面用，同源加载避免跨域纹理污染）
    vdir = os.path.join(WEBUI, "videos")
    if os.path.isdir(vdir):
        for v in sorted(os.listdir(vdir)):
            files.append(("webui/videos/" + v, os.path.join(vdir, v)))
    # 自定义模型（Draco 压缩体积小，随部署上传）+ 模型清单 + 缩略图 + Draco 解码器
    for f in ["cabinet_custom.glb", "storage_bin.glb"]:
        p = os.path.join(WEBUI, "models", f)
        if os.path.isfile(p):
            files.append(("webui/models/" + f, p))
    for f in ["manifest.json"]:
        p = os.path.join(WEBUI, "models", f)
        if os.path.isfile(p):
            files.append(("webui/models/" + f, p))
    for t in ["cabinet_custom.webp", "storage_bin.webp"]:
        tp = os.path.join(WEBUI, "models", "thumbs", t)
        if os.path.isfile(tp):
            files.append(("webui/models/thumbs/" + t, tp))
    # 内置家具缩略图（furn_*.webp，模型库用）
    for tp in glob.glob(os.path.join(WEBUI, "models", "thumbs", "furn_*.webp")):
        files.append(("webui/models/thumbs/" + os.path.basename(tp), tp))
    for f in ["draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"]:
        p = os.path.join(WEBUI, "draco", f)
        if os.path.isfile(p):
            files.append(("webui/draco/" + f, p))
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

        # 1) 优先用 supervisor 拿 ingress_url + session（有权限时）
        itok, sess = None, None
        try:
            r = await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/info", "method": "get"})
            d = r.get("result", {})
            itok = d.get("ingress_url", "").rstrip("/").split("/")[-1]
        except Exception:
            itok = None
        if itok:
            try:
                r = await call({"id": nid(), "type": "auth/current_user"})
                uid = r["result"]["id"]
                r = await call({"id": nid(), "type": "supervisor/api", "endpoint": "/ingress/session", "method": "post", "data": {"user_id": uid}})
                sess = (r.get("result") or {}).get("session")
            except Exception:
                sess = None

        # 2) supervisor 拿不到就回退到 /tmp 里的 ingress 凭据
        if not itok and os.path.exists("/tmp/ai3d_token.txt"):
            itok = open("/tmp/ai3d_token.txt").read().strip()
            sess = open("/tmp/ai3d_ingress.txt").read().strip() if os.path.exists("/tmp/ai3d_ingress.txt") else None
        if not itok:
            print("  ✗ 拿不到 ingress token（supervisor 无权限且 /tmp 没有备份）", flush=True)
            return

        # 3) 上传
        url = f"http://{HA}/api/hassio_ingress/{itok}/api/deploy"
        hdr = {"Content-Type": "application/json"}
        if sess:
            hdr["Cookie"] = f"ingress_session={sess}"
        req = urllib.request.Request(url, data=json.dumps({"tar": tar_b64}).encode(), method="POST", headers=hdr)
        try:
            resp = urllib.request.urlopen(req, timeout=120).read()
            print("  上传:", resp.decode(), flush=True)
        except Exception as e:
            print("  上传失败:", e, flush=True)
            return

        # 4) 重启（supervisor 有权限就自动重启；没有则提示手动）
        try:
            await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/restart", "method": "post", "timeout": 90})
            await asyncio.sleep(10)
            r = await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/info", "method": "get"})
            print("  状态:", r.get("result", {}).get("state"), flush=True)
        except Exception:
            print("  ⚠️ 上传成功，但没权限自动重启，请到 HA 界面手动重启「AI 3D Home」加载项", flush=True)


def main():
    token = read_token()
    build()
    tar_b64 = package()
    asyncio.run(deploy(tar_b64, token))


if __name__ == "__main__":
    main()

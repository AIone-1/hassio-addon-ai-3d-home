#!/usr/bin/env python3
"""重新安装加载项（比 ha_deploy_ai3d.py 快：不删仓库，直接安装）。

仓库缓存还在就直接装；不在了就加一次。之后 start + 配 options + restart。
"""
import asyncio, json, websockets, re, os

TOKEN = None
with open("/tmp/ha_deploy_ai3d.py", encoding="utf-8") as f:
    TOKEN = re.search(r'TOKEN\s*=\s*"([^"]+)"', f.read()).group(1)

REPO = "https://github.com/AIone-1/hassio-addon-ai-3d-home"
REPO_SLUG = "981c17cd"
SLUG = "981c17cd_ai_3d_home"
HA = "192.168.10.123:8123"


async def main():
    async with websockets.connect(f"ws://{HA}/api/websocket", max_size=None) as ws:
        await ws.recv()
        await ws.send(json.dumps({"type": "auth", "access_token": TOKEN}))
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

        # 1. 安装（仓库缓存还在就直接装，很快；不在了会失败，就去加仓库）
        r = await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/install", "method": "post", "timeout": 600})
        if not r.get("success"):
            print("直接安装失败，尝试加仓库...", flush=True)
            for i in range(4):
                r = await call({"id": nid(), "type": "supervisor/api", "endpoint": "/store/repositories", "method": "post", "data": {"repository": REPO}})
                if r.get("success"):
                    break
                await asyncio.sleep(6)
            await asyncio.sleep(5)
            r = await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/install", "method": "post", "timeout": 600})
        print("安装:", "OK" if r.get("success") else json.dumps(r, ensure_ascii=False)[:150], flush=True)

        # 2. 等状态 + 启动
        for i in range(120):
            r = await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/info", "method": "get"})
            st = r.get("result", {}).get("state")
            if st in ("started", "stopped", "error", "unknown"):
                break
            await asyncio.sleep(3)
        if r.get("result", {}).get("state") != "started":
            await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/start", "method": "post", "timeout": 90})
        await asyncio.sleep(5)

        # 3. 配 options + 面板
        await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/options", "method": "post", "data": {"options": {"ha_host": "192.168.10.123", "ha_port": 8123, "ha_token": TOKEN, "poll_interval": 3}}})
        await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/options", "method": "post", "data": {"ingress_panel": True}})
        await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/restart", "method": "post", "timeout": 90})
        await asyncio.sleep(8)

        r = await call({"id": nid(), "type": "supervisor/api", "endpoint": f"/addons/{SLUG}/info", "method": "get"})
        d = r.get("result", {})
        print("状态:", d.get("state"), "| version:", d.get("version"), flush=True)


asyncio.run(main())

#!/bin/bash
set -e

export TZ="Asia/Shanghai"

DATA_DIR="/share/ai_3d_home"
mkdir -p "$DATA_DIR"

# 首次启动初始化
[ -f "$DATA_DIR/project.json" ] || echo '{"floors":[],"version":1}' > "$DATA_DIR/project.json"
[ -f "$DATA_DIR/settings.json" ] || echo '{}' > "$DATA_DIR/settings.json"

echo "[ai_3d_home] 数据目录: $DATA_DIR"
exec python3 /usr/local/bin/server.py

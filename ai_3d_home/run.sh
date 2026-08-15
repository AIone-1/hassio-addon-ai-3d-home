#!/bin/bash
set -e

export TZ="Asia/Shanghai"

DATA_DIR="/share/ai_3d_home"
mkdir -p "$DATA_DIR"

# 首次启动初始化
[ -f "$DATA_DIR/project.json" ] || echo '{"floors":[],"version":1}' > "$DATA_DIR/project.json"
[ -f "$DATA_DIR/settings.json" ] || echo '{}' > "$DATA_DIR/settings.json"

# 本地更新优先：share 里有更新的代码（本地部署上传的）就用 share 的，否则用镜像自带的
if [ -f "$DATA_DIR/server.py" ]; then
  cp "$DATA_DIR/server.py" /usr/local/bin/server.py
fi
if [ -f "$DATA_DIR/webui/index.html" ]; then
  export WEBUI_DIR="$DATA_DIR/webui"
fi

echo "[ai_3d_home] 数据目录: $DATA_DIR"
exec python3 /usr/local/bin/server.py

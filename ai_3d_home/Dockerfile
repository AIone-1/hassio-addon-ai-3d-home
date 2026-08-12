# 自包含构建：标准 HA Alpine 基础镜像 + Python 标准库后端 + 预构建 React 前端
ARG BUILD_FROM=ghcr.io/home-assistant/aarch64-base:latest
FROM $BUILD_FROM

# 后端只用 Python 标准库，零第三方依赖
RUN apk add --no-cache python3 ca-certificates tzdata

COPY run.sh /run.sh
COPY rootfs/usr/local/bin/server.py /usr/local/bin/server.py
COPY rootfs/usr/local/bin/webui /usr/local/bin/webui

RUN chmod a+x /run.sh

WORKDIR /data
CMD ["/run.sh"]

#!/bin/bash
# 生成扩展图标 icons/icon{16,32,48,128}.png。
# 用本机 Google Chrome 无头模式按目标尺寸直接渲染 tools/icon.html（字形按像素尺寸排版，比缩放更清晰）。
# 依赖 macOS 自带的 PingFang SC 字体；改设计请编辑 tools/icon.html。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

for size in 16 32 48 128; do
  "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --user-data-dir="$PROFILE" --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$size,$size" \
    --screenshot="$ROOT/icons/icon$size.png" "file://$ROOT/tools/icon.html?size=$size" >/dev/null 2>&1
  echo "icons/icon$size.png"
done

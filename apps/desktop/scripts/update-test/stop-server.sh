#!/bin/bash

# ============================================
# 停止本地更新服务器
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/.server.pid"
LOG_FILE="$SCRIPT_DIR/.server.log"

if [ ! -f "$PID_FILE" ]; then
  echo "ℹ️  服务器未运行 (找不到 PID 文件)"
  exit 0
fi

PID=$(cat "$PID_FILE")

if ps -p "$PID" > /dev/null 2>&1; then
  echo "🛑 停止服务器 (PID: $PID)..."
  kill "$PID"
  sleep 1

  # 强制终止（如果还在运行）
  if ps -p "$PID" > /dev/null 2>&1; then
    kill -9 "$PID" 2> /dev/null
  fi

  echo "✅ 服务器已停止"
else
  echo "ℹ️  服务器进程已不存在"
fi

rm -f "$PID_FILE"

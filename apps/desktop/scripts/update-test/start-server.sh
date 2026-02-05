#!/bin/bash

# ============================================
# 启动本地更新服务器
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
PID_FILE="$SCRIPT_DIR/.server.pid"
LOG_FILE="$SCRIPT_DIR/.server.log"
PORT="${PORT:-8787}"

# 检查服务器目录
if [ ! -d "$SERVER_DIR" ]; then
  echo "❌ 服务器目录不存在，请先运行 ./setup.sh"
  exit 1
fi

# 检查是否已经在运行
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if ps -p "$OLD_PID" > /dev/null 2>&1; then
    echo "⚠️  服务器已经在运行 (PID: $OLD_PID)"
    echo "   地址: http://localhost:$PORT"
    echo ""
    echo "   如需重启，请先运行 ./stop-server.sh"
    exit 0
  else
    rm -f "$PID_FILE"
  fi
fi

echo "🚀 启动本地更新服务器..."
echo "   目录: $SERVER_DIR"
echo "   端口: $PORT"
echo ""

# 列出服务器目录中的文件
echo "📦 可用文件:"
ls -la "$SERVER_DIR" | grep -v "^d" | grep -v "^total" | awk '{print "   " $NF}'
echo ""

# 启动服务器 (后台运行)
cd "$SERVER_DIR"
nohup npx serve -p "$PORT" --cors -n > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

# 等待服务器启动
sleep 2

# 检查是否启动成功
if ps -p "$SERVER_PID" > /dev/null 2>&1; then
  echo "✅ 服务器已启动!"
  echo ""
  echo "   地址: http://localhost:$PORT"
  echo "   PID:  $SERVER_PID"
  echo "   日志: $LOG_FILE"
  echo ""
  echo "📋 测试 URL:"
  echo "   latest-mac.yml: http://localhost:$PORT/latest-mac.yml"
  echo "   latest.yml:     http://localhost:$PORT/latest.yml"
  echo ""
  echo "🛑 停止服务器: ./stop-server.sh"
else
  echo "❌ 服务器启动失败"
  echo "   查看日志: cat $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi

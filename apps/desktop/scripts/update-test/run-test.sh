#!/bin/bash

# ============================================
# 一键启动本地更新测试 (含 Channel 切换)
# ============================================
#
# 两种测试模式:
#   1. 打包模式 (默认): 构建打包后的应用，可完整测试更新流程
#   2. 开发模式 (--dev): 使用 bun run dev，仅测试 UI 和 IPC，
#      updater 不会初始化 (isDev=true 时 enableAppUpdate=false)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
PORT="${PORT:-8787}"
DEV_MODE=false

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --dev)
      DEV_MODE=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

echo "============================================"
echo "🧪 本地更新测试 - Channel 切换"
if [ "$DEV_MODE" = true ]; then
  echo "   模式: 开发模式 (仅 UI/IPC 测试)"
else
  echo "   模式: 打包模式 (完整更新流程)"
fi
echo "============================================"
echo ""

# 检查 macOS Gatekeeper 状态
check_gatekeeper() {
  if command -v spctl &> /dev/null; then
    STATUS=$(spctl --status 2>&1 || true)
    if [[ "$STATUS" == *"enabled"* ]]; then
      echo "⚠️  警告: macOS Gatekeeper 已启用"
      echo ""
      echo "   未签名的应用可能无法安装。你可以:"
      echo "   1. 临时禁用: sudo spctl --master-disable"
      echo "   2. 或者在安装后手动允许应用"
      echo ""
      read -p "是否继续？[y/N] " -n 1 -r
      echo ""
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
      fi
    else
      echo "✅ Gatekeeper 已禁用，可以安装未签名应用"
    fi
  fi
}

# 步骤 1: 设置
echo "📦 步骤 1: 设置测试环境..."
cd "$SCRIPT_DIR"
chmod +x *.sh
mkdir -p server/stable server/nightly server/canary

if [ "$DEV_MODE" = true ]; then
  # ============================================
  # 开发模式: 只启动服务器 + dev
  # ============================================

  # 生成 mock manifest (不需要真实构建产物)
  echo ""
  echo "📝 步骤 2: 生成 mock manifest..."
  for ch in stable nightly canary; do
    cat > "server/$ch/$ch-mac.yml" << EOF
version: 99.0.0-$ch.1
files:
  - url: mock.dmg
    sha512: placeholder
    size: 100000000
path: mock.dmg
sha512: placeholder
releaseDate: '$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")'
releaseNotes: |
  ## v99.0.0-$ch.1 本地测试 ($ch 渠道)
  Mock manifest for UI testing.
EOF
    echo "   ✅ $ch/$ch-mac.yml (v99.0.0-$ch.1)"
  done

  # 启动服务器
  echo ""
  echo "🚀 步骤 3: 启动本地服务器..."
  ./start-server.sh

  echo ""
  echo "============================================"
  echo "✅ 准备完成！(开发模式)"
  echo "============================================"
  echo ""
  echo "⚠️  注意: 开发模式下 updater 不会初始化"
  echo "   仅可测试: Settings > Beta 页面 UI、IPC 通信"
  echo "   不可测试: 实际更新检查、下载、安装"
  echo ""
  echo "启动应用:"
  echo "  cd $DESKTOP_DIR"
  echo "  UPDATE_SERVER_URL=http://localhost:$PORT bun run dev"
  echo ""
  read -p "是否现在启动应用？[Y/n] " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    echo "🚀 启动应用..."
    cd "$DESKTOP_DIR"
    UPDATE_SERVER_URL="http://localhost:$PORT" bun run dev
  fi

else
  # ============================================
  # 打包模式: 完整更新流程测试
  # ============================================

  # 步骤 2: 检查构建产物
  echo ""
  echo "📂 步骤 2: 检查构建产物..."
  if [ ! -d "$DESKTOP_DIR/release" ] || [ -z "$(ls -A "$DESKTOP_DIR/release"/*.dmg 2> /dev/null)" ]; then
    echo "❌ 未找到构建产物"
    echo ""
    echo "请先构建应用 (需产出 DMG + ZIP):"
    echo "  cd $DESKTOP_DIR"
    echo "  bun run package:mac:local"
    echo ""
    exit 1
  fi

  # 检查 ZIP 文件
  if [ -z "$(ls -A "$DESKTOP_DIR/release"/*.zip 2> /dev/null)" ]; then
    echo "⚠️  未找到 ZIP 文件，macOS 自动更新需要 ZIP"
    echo "   请使用 bun run package:mac:local 构建"
    echo ""
    read -p "是否仍然继续 (仅生成 DMG manifest)？[y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      exit 1
    fi
  fi

  # 步骤 3: 为所有渠道生成 manifest
  echo ""
  echo "📝 步骤 3: 为 stable/nightly/canary 生成 manifest..."
  ./generate-manifest.sh --from-release --all-channels

  # 步骤 4: 启动服务器
  echo ""
  echo "🚀 步骤 4: 启动本地服务器..."
  ./start-server.sh

  # 步骤 5: 配置应用
  echo ""
  echo "⚙️  步骤 5: 配置应用..."
  cp "$SCRIPT_DIR/dev-app-update.local.yml" "$DESKTOP_DIR/dev-app-update.yml"
  echo "✅ 已更新 dev-app-update.yml"

  # 检查 Gatekeeper
  echo ""
  check_gatekeeper

  echo ""
  echo "============================================"
  echo "✅ 准备完成！(打包模式)"
  echo "============================================"
  echo ""
  echo "📡 服务器渠道:"
  echo "   stable  -> http://localhost:$PORT/stable/stable-mac.yml"
  echo "   nightly -> http://localhost:$PORT/nightly/nightly-mac.yml"
  echo "   canary  -> http://localhost:$PORT/canary/canary-mac.yml"
  echo ""
  echo "🔄 测试 Channel 切换:"
  echo "   1. 启动打包后的应用"
  echo "   2. 进入 设置 > Beta"
  echo "   3. 在 Update Channel 下拉框中切换渠道"
  echo "   4. 查看日志: tail -f ~/Library/Logs/lobehub-desktop/main.log"
  echo ""
  echo "运行打包后的应用:"
  echo "  需设置环境变量: FORCE_DEV_UPDATE_CONFIG=true UPDATE_SERVER_URL=http://localhost:$PORT"
  echo ""

  # 查找并提供启动打包应用的命令
  APP_PATH=$(find "$DESKTOP_DIR/release" -maxdepth 2 -name "*.app" -type d | head -1)
  if [ -n "$APP_PATH" ]; then
    echo "检测到打包应用: $APP_PATH"
    echo ""
    read -p "是否现在启动？[Y/n] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      echo "🚀 启动应用..."
      FORCE_DEV_UPDATE_CONFIG=true UPDATE_SERVER_URL="http://localhost:$PORT" open "$APP_PATH"
    fi
  else
    echo "未找到 .app，请手动启动打包后的应用"
  fi
fi

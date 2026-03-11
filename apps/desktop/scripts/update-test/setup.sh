#!/bin/bash

# ============================================
# 本地更新测试 - 一键设置脚本
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"

echo "🚀 设置本地更新测试环境..."

# 创建服务器目录（含三个渠道子目录）
mkdir -p "$SERVER_DIR/stable"
mkdir -p "$SERVER_DIR/nightly"
mkdir -p "$SERVER_DIR/canary"
echo "✅ 创建服务器目录: $SERVER_DIR/{stable,nightly,canary}"

# 设置脚本执行权限
chmod +x "$SCRIPT_DIR"/*.sh
echo "✅ 设置脚本执行权限"

# 检查是否安装了 serve
if ! command -v npx &> /dev/null; then
  echo "❌ 需要安装 Node.js 和 npm"
  exit 1
fi

# 为三个渠道创建示例 manifest
for ch in stable nightly canary; do
  cat > "$SERVER_DIR/$ch/$ch-mac.yml" << EOF
version: 99.0.0
files:
  - url: LobeHub-99.0.0-arm64.dmg
    sha512: placeholder-sha512-will-be-replaced
    size: 100000000
  - url: LobeHub-99.0.0-arm64-mac.zip
    sha512: placeholder-sha512-will-be-replaced
    size: 100000000
path: LobeHub-99.0.0-arm64.dmg
sha512: placeholder-sha512-will-be-replaced
releaseDate: '2026-01-15T10:00:00.000Z'
releaseNotes: |
  ## v99.0.0 本地测试版本 ($ch)

  这是 $ch 渠道的模拟版本。
EOF
  echo "✅ 创建示例 $ch/$ch-mac.yml"
done

# 创建本地测试用的 dev-app-update.yml
cat > "$SCRIPT_DIR/dev-app-update.local.yml" << 'EOF'
# 本地更新测试配置
# 将此文件复制到 apps/desktop/dev-app-update.yml 以使用本地服务器测试
#
# 注意: 此配置仅用于应用初始启动时的 provider 配置。
# Channel 切换功能通过 UPDATE_SERVER_URL 环境变量 + setFeedURL() 实现，
# 不依赖此文件。
#
# 使用方法:
#   cp scripts/update-test/dev-app-update.local.yml dev-app-update.yml
#   UPDATE_SERVER_URL=http://localhost:8787 bun run dev

provider: generic
url: http://localhost:8787/stable
updaterCacheDirName: lobehub-desktop-local-test
channel: stable
EOF
echo "✅ 创建本地测试配置文件"

echo ""
echo "============================================"
echo "✅ 设置完成！"
echo "============================================"
echo ""
echo "下一步操作："
echo ""
echo "1. 构建测试包 (需产出 DMG + ZIP)："
echo "   cd $(dirname "$SCRIPT_DIR")"
echo "   bun run package:mac:local"
echo ""
echo "2. 生成真实的 manifest (从构建产物)："
echo "   cd scripts/update-test"
echo "   ./generate-manifest.sh --from-release --all-channels"
echo ""
echo "3. 或者直接一键测试："
echo "   ./run-test.sh"
echo ""

#!/bin/bash

# ============================================
# 本地更新测试 - 一键设置脚本
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"

echo "🚀 设置本地更新测试环境..."

# 创建服务器目录
mkdir -p "$SERVER_DIR"
echo "✅ 创建服务器目录: $SERVER_DIR"

# 设置脚本执行权限
chmod +x "$SCRIPT_DIR"/*.sh
echo "✅ 设置脚本执行权限"

# 检查是否安装了 serve
if ! command -v npx &> /dev/null; then
  echo "❌ 需要安装 Node.js 和 npm"
  exit 1
fi

# 创建示例 latest-mac.yml
cat > "$SERVER_DIR/latest-mac.yml" << 'EOF'
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
  ## 🎉 v99.0.0 本地测试版本

  这是一个用于本地测试更新功能的模拟版本。

  ### ✨ 新功能
  - 测试功能 A
  - 测试功能 B

  ### 🐛 修复
  - 修复测试问题 X
EOF
echo "✅ 创建示例 latest-mac.yml"

# 创建 Windows 版本的 manifest (可选)
cat > "$SERVER_DIR/latest.yml" << 'EOF'
version: 99.0.0
files:
  - url: LobeHub-99.0.0-setup.exe
    sha512: placeholder-sha512-will-be-replaced
    size: 100000000
path: LobeHub-99.0.0-setup.exe
sha512: placeholder-sha512-will-be-replaced
releaseDate: '2026-01-15T10:00:00.000Z'
releaseNotes: |
  ## 🎉 v99.0.0 本地测试版本

  这是一个用于本地测试更新功能的模拟版本。
EOF
echo "✅ 创建示例 latest.yml (Windows)"

# 创建本地测试用的 dev-app-update.yml
cat > "$SCRIPT_DIR/dev-app-update.local.yml" << 'EOF'
# 本地更新测试配置
# 将此文件复制到 apps/desktop/dev-app-update.yml 以使用本地服务器测试

provider: generic
url: http://localhost:8787
updaterCacheDirName: lobehub-desktop-local-test
EOF
echo "✅ 创建本地测试配置文件"

echo ""
echo "============================================"
echo "✅ 设置完成！"
echo "============================================"
echo ""
echo "下一步操作："
echo ""
echo "1. 构建测试包："
echo "   cd $(dirname "$SCRIPT_DIR")"
echo "   npm run build-local"
echo ""
echo "2. 复制构建产物到服务器目录："
echo "   cp release/*.dmg scripts/update-test/server/"
echo "   cp release/*.zip scripts/update-test/server/"
echo ""
echo "3. 更新 manifest 文件（可选）："
echo "   cd scripts/update-test"
echo "   ./generate-manifest.sh"
echo ""
echo "4. 启动本地服务器："
echo "   ./start-server.sh"
echo ""
echo "5. 配置应用使用本地服务器："
echo "   cp dev-app-update.local.yml ../../dev-app-update.yml"
echo ""
echo "6. 运行应用："
echo "   cd ../.."
echo "   npm run dev"
echo ""

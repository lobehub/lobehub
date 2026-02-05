#!/bin/bash

# ============================================
# 一键启动本地更新测试
# ============================================
#
# 此脚本会:
# 1. 设置测试环境
# 2. 从 release 目录复制文件
# 3. 生成 manifest
# 4. 启动本地服务器
# 5. 配置应用使用本地服务器
# 6. 启动应用
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "============================================"
echo "🧪 本地更新测试 - 一键启动"
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
echo "📦 步骤 1/5: 设置测试环境..."
cd "$SCRIPT_DIR"
chmod +x *.sh
mkdir -p server

# 步骤 2: 检查 release 目录
echo ""
echo "📂 步骤 2/5: 检查构建产物..."
if [ ! -d "$DESKTOP_DIR/release" ] || [ -z "$(ls -A "$DESKTOP_DIR/release"/*.dmg 2> /dev/null)" ]; then
  echo "❌ 未找到构建产物"
  echo ""
  echo "请先构建应用:"
  echo "  cd $DESKTOP_DIR"
  echo "  npm run build-local"
  echo ""
  exit 1
fi

# 步骤 3: 生成 manifest
echo ""
echo "📝 步骤 3/5: 生成 manifest 文件..."
./generate-manifest.sh --from-release

# 步骤 4: 启动服务器
echo ""
echo "🚀 步骤 4/5: 启动本地服务器..."
./start-server.sh

# 步骤 5: 配置并启动应用
echo ""
echo "⚙️  步骤 5/5: 配置应用..."
cp "$SCRIPT_DIR/dev-app-update.local.yml" "$DESKTOP_DIR/dev-app-update.yml"
echo "✅ 已更新 dev-app-update.yml"

# 检查 Gatekeeper
echo ""
check_gatekeeper

echo ""
echo "============================================"
echo "✅ 准备完成！"
echo "============================================"
echo ""
echo "现在可以运行应用进行测试:"
echo ""
echo "  cd $DESKTOP_DIR"
echo "  npm run dev"
echo ""
echo "或者直接运行:"
read -p "是否现在启动应用？[Y/n] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  echo ""
  echo "🚀 启动应用..."
  cd "$DESKTOP_DIR"
  npm run dev
fi

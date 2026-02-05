#!/bin/bash

# ============================================
# 生成更新 manifest 文件 ({channel}-mac.yml)
#
# 目录结构:
#   server/
#     {channel}/
#       {channel}-mac.yml  (e.g., stable-mac.yml)
#       {version}/
#         xxx.dmg
#         xxx.zip
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/server"
DESKTOP_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
RELEASE_DIR="$DESKTOP_DIR/release"

# 默认值
VERSION=""
CHANNEL="stable"
DMG_FILE=""
ZIP_FILE=""
RELEASE_NOTES=""
FROM_RELEASE=false

# 帮助信息
show_help() {
  echo "用法: $0 [选项]"
  echo ""
  echo "选项:"
  echo "  -v, --version VERSION    指定版本号 (例如: 2.0.1)"
  echo "  -c, --channel CHANNEL    指定渠道 (stable|beta|nightly, 默认: stable)"
  echo "  -d, --dmg FILE           指定 DMG 文件名"
  echo "  -z, --zip FILE           指定 ZIP 文件名"
  echo "  -n, --notes TEXT         指定 release notes"
  echo "  -f, --from-release       从 release 目录自动复制文件"
  echo "  -h, --help               显示帮助信息"
  echo ""
  echo "示例:"
  echo "  $0 --from-release"
  echo "  $0 -v 2.0.1 -c stable -d LobeHub-2.0.1-arm64.dmg"
  echo "  $0 -v 2.1.0-beta.1 -c beta --from-release"
  echo ""
  echo "生成的目录结构:"
  echo "  server/"
  echo "    {channel}/"
  echo "      {channel}-mac.yml  (e.g., stable-mac.yml)"
  echo "      {version}/"
  echo "        xxx.dmg"
  echo "        xxx.zip"
  echo ""
}

# 计算 SHA512
calc_sha512() {
  local file="$1"
  if [ -f "$file" ]; then
    shasum -a 512 "$file" | awk '{print $1}' | xxd -r -p | base64
  else
    echo "placeholder-sha512-file-not-found"
  fi
}

# 获取文件大小
get_file_size() {
  local file="$1"
  if [ -f "$file" ]; then
    stat -f%z "$file" 2> /dev/null || stat --printf="%s" "$file" 2> /dev/null || echo "0"
  else
    echo "0"
  fi
}

# 解析参数
FROM_RELEASE=false
while [[ $# -gt 0 ]]; do
  case $1 in
    -v | --version)
      VERSION="$2"
      shift 2
      ;;
    -c | --channel)
      CHANNEL="$2"
      shift 2
      ;;
    -d | --dmg)
      DMG_FILE="$2"
      shift 2
      ;;
    -z | --zip)
      ZIP_FILE="$2"
      shift 2
      ;;
    -n | --notes)
      RELEASE_NOTES="$2"
      shift 2
      ;;
    -f | --from-release)
      FROM_RELEASE=true
      shift
      ;;
    -h | --help)
      show_help
      exit 0
      ;;
    *)
      echo "未知参数: $1"
      show_help
      exit 1
      ;;
  esac
done

echo "🔧 生成更新 manifest 文件..."
echo "   渠道: $CHANNEL"
echo ""

# 渠道目录
CHANNEL_DIR="$SERVER_DIR/$CHANNEL"

# 自动从 release 目录检测和复制
if [ "$FROM_RELEASE" = true ]; then
  echo "📂 从 release 目录检测文件..."

  if [ ! -d "$RELEASE_DIR" ]; then
    echo "❌ release 目录不存在: $RELEASE_DIR"
    echo "   请先运行构建命令"
    exit 1
  fi

  # 查找 DMG 文件
  DMG_PATH=$(find "$RELEASE_DIR" -maxdepth 1 -name "*.dmg" -type f | head -1)
  if [ -n "$DMG_PATH" ]; then
    DMG_FILE=$(basename "$DMG_PATH")
    echo "   找到 DMG: $DMG_FILE"
  fi

  # 查找 ZIP 文件
  ZIP_PATH=$(find "$RELEASE_DIR" -maxdepth 1 -name "*-mac.zip" -type f | head -1)
  if [ -n "$ZIP_PATH" ]; then
    ZIP_FILE=$(basename "$ZIP_PATH")
    echo "   找到 ZIP: $ZIP_FILE"
  fi

  # 从文件名提取版本号
  # 文件名格式: lobehub-desktop-dev-0.0.0-arm64.dmg
  # 版本号格式: x.y.z 或 x.y.z-beta.1 等
  if [ -z "$VERSION" ] && [ -n "$DMG_FILE" ]; then
    # 先尝试匹配带预发布标签的版本 (如 2.0.0-beta.1)
    VERSION=$(echo "$DMG_FILE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+-(alpha|beta|rc|nightly)\.[0-9]+' | head -1)
    # 如果没有预发布标签，只匹配基本版本号 (如 2.0.0)
    if [ -z "$VERSION" ]; then
      VERSION=$(echo "$DMG_FILE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    fi
  fi
fi

# 设置默认版本号
if [ -z "$VERSION" ]; then
  VERSION="0.0.1"
  echo "⚠️  未指定版本号，使用默认值: $VERSION"
fi

# 版本目录
VERSION_DIR="$CHANNEL_DIR/$VERSION"

# 创建目录结构
echo ""
echo "📁 创建目录结构..."
mkdir -p "$VERSION_DIR"
echo "   $CHANNEL_DIR/"
echo "     $VERSION/"

# 复制文件到版本目录
if [ "$FROM_RELEASE" = true ]; then
  if [ -n "$DMG_PATH" ] && [ -f "$DMG_PATH" ]; then
    echo "   复制 $DMG_FILE -> $VERSION/"
    cp "$DMG_PATH" "$VERSION_DIR/"
  fi

  if [ -n "$ZIP_PATH" ] && [ -f "$ZIP_PATH" ]; then
    echo "   复制 $ZIP_FILE -> $VERSION/"
    cp "$ZIP_PATH" "$VERSION_DIR/"
  fi
fi

# 设置默认 release notes
if [ -z "$RELEASE_NOTES" ]; then
  RELEASE_NOTES="## 🎉 v$VERSION 本地测试版本

这是一个用于本地测试更新功能的模拟版本。

### ✨ 新功能
- 测试自动更新功能
- 验证更新流程

### 🐛 修复
- 本地测试环境配置"
fi

# 生成 {channel}-mac.yml (e.g., stable-mac.yml)
MANIFEST_FILE="$CHANNEL-mac.yml"
echo ""
echo "📝 生成 $CHANNEL/$MANIFEST_FILE..."

DMG_SHA512=""
DMG_SIZE="0"
ZIP_SHA512=""
ZIP_SIZE="0"

if [ -n "$DMG_FILE" ] && [ -f "$VERSION_DIR/$DMG_FILE" ]; then
  echo "   计算 DMG SHA512..."
  DMG_SHA512=$(calc_sha512 "$VERSION_DIR/$DMG_FILE")
  DMG_SIZE=$(get_file_size "$VERSION_DIR/$DMG_FILE")
fi

if [ -n "$ZIP_FILE" ] && [ -f "$VERSION_DIR/$ZIP_FILE" ]; then
  echo "   计算 ZIP SHA512..."
  ZIP_SHA512=$(calc_sha512 "$VERSION_DIR/$ZIP_FILE")
  ZIP_SIZE=$(get_file_size "$VERSION_DIR/$ZIP_FILE")
fi

# 写入 manifest 文件 (放在渠道目录下)
cat > "$CHANNEL_DIR/$MANIFEST_FILE" << EOF
version: $VERSION
files:
EOF

if [ -n "$DMG_FILE" ]; then
  cat >> "$CHANNEL_DIR/$MANIFEST_FILE" << EOF
  - url: $VERSION/$DMG_FILE
    sha512: ${DMG_SHA512:-placeholder}
    size: $DMG_SIZE
EOF
fi

if [ -n "$ZIP_FILE" ]; then
  cat >> "$CHANNEL_DIR/$MANIFEST_FILE" << EOF
  - url: $VERSION/$ZIP_FILE
    sha512: ${ZIP_SHA512:-placeholder}
    size: $ZIP_SIZE
EOF
fi

cat >> "$CHANNEL_DIR/$MANIFEST_FILE" << EOF
path: $VERSION/${DMG_FILE:-LobeHub-$VERSION-arm64.dmg}
sha512: ${DMG_SHA512:-placeholder}
releaseDate: '$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")'
releaseNotes: |
$(echo "$RELEASE_NOTES" | sed 's/^/  /')
EOF

echo "✅ 已生成 $CHANNEL_DIR/$MANIFEST_FILE"

# 显示生成的文件内容
echo ""
echo "📋 文件内容:"
echo "----------------------------------------"
cat "$CHANNEL_DIR/$MANIFEST_FILE"
echo "----------------------------------------"

# 显示目录结构
echo ""
echo "📁 目录结构:"
find "$CHANNEL_DIR" -type f | sed "s|$SERVER_DIR/||" | sort

echo ""
echo "✅ 完成！"
echo ""
echo "下一步:"
echo "  1. 启动服务器: ./start-server.sh"
echo "  2. 确认 dev-app-update.yml 的 URL 为: http://localhost:8787/$CHANNEL"
echo "  3. 运行应用:   cd ../.. && bun run dev"

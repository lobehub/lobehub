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
ALL_CHANNELS=false

# 帮助信息
show_help() {
  echo "用法: $0 [选项]"
  echo ""
  echo "选项:"
  echo "  -v, --version VERSION    指定版本号 (例如: 2.0.1)"
  echo "  -c, --channel CHANNEL    指定渠道 (stable|nightly|canary, 默认: stable)"
  echo "  -a, --all-channels       为所有渠道生成 manifest (stable/nightly/canary)"
  echo "  -d, --dmg FILE           指定 DMG 文件名"
  echo "  -z, --zip FILE           指定 ZIP 文件名"
  echo "  -n, --notes TEXT         指定 release notes"
  echo "  -f, --from-release       从 release 目录自动复制文件"
  echo "  -h, --help               显示帮助信息"
  echo ""
  echo "示例:"
  echo "  $0 --from-release"
  echo "  $0 -v 2.0.1 -c stable -d LobeHub-2.0.1-arm64.dmg"
  echo "  $0 --from-release --all-channels"
  echo "  $0 -v 2.1.0-nightly.1 -c nightly --from-release"
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

# 为单个渠道生成 manifest
generate_for_channel() {
  local ch="$1"
  local ver="$2"
  local dmg="$3"
  local zip="$4"
  local notes="$5"
  local dmg_path="$6"
  local zip_path="$7"

  local ch_dir="$SERVER_DIR/$ch"
  local ver_dir="$ch_dir/$ver"

  echo ""
  echo "📦 渠道: $ch  版本: $ver"

  mkdir -p "$ver_dir"

  # 复制文件到版本目录
  if [ -n "$dmg_path" ] && [ -f "$dmg_path" ]; then
    echo "   复制 $dmg -> $ch/$ver/"
    cp -f "$dmg_path" "$ver_dir/"
  fi

  if [ -n "$zip_path" ] && [ -f "$zip_path" ]; then
    echo "   复制 $zip -> $ch/$ver/"
    cp -f "$zip_path" "$ver_dir/"
  fi

  # 计算哈希
  local dmg_sha512="" dmg_size="0" zip_sha512="" zip_size="0"

  if [ -n "$dmg" ] && [ -f "$ver_dir/$dmg" ]; then
    echo "   计算 DMG SHA512..."
    dmg_sha512=$(calc_sha512 "$ver_dir/$dmg")
    dmg_size=$(get_file_size "$ver_dir/$dmg")
  fi

  if [ -n "$zip" ] && [ -f "$ver_dir/$zip" ]; then
    echo "   计算 ZIP SHA512..."
    zip_sha512=$(calc_sha512 "$ver_dir/$zip")
    zip_size=$(get_file_size "$ver_dir/$zip")
  fi

  # 生成 {channel}-mac.yml
  local manifest="$ch-mac.yml"

  cat > "$ch_dir/$manifest" << EOF
version: $ver
files:
EOF

  if [ -n "$dmg" ]; then
    cat >> "$ch_dir/$manifest" << EOF
  - url: $ver/$dmg
    sha512: ${dmg_sha512:-placeholder}
    size: $dmg_size
EOF
  fi

  if [ -n "$zip" ]; then
    cat >> "$ch_dir/$manifest" << EOF
  - url: $ver/$zip
    sha512: ${zip_sha512:-placeholder}
    size: $zip_size
EOF
  fi

  cat >> "$ch_dir/$manifest" << EOF
path: $ver/${dmg:-LobeHub-$ver-arm64.dmg}
sha512: ${dmg_sha512:-placeholder}
releaseDate: '$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")'
releaseNotes: |
$(echo "$notes" | sed 's/^/  /')
EOF

  echo "   ✅ 生成 $ch/$manifest"
}

# 解析参数
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
    -a | --all-channels)
      ALL_CHANNELS=true
      shift
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

DMG_PATH=""
ZIP_PATH=""

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

  # 查找 ZIP 文件 (尝试多种命名模式)
  ZIP_PATH=$(find "$RELEASE_DIR" -maxdepth 1 -name "*-mac.zip" -type f | head -1)
  if [ -z "$ZIP_PATH" ]; then
    ZIP_PATH=$(find "$RELEASE_DIR" -maxdepth 1 -name "*.zip" -type f | head -1)
  fi
  if [ -n "$ZIP_PATH" ]; then
    ZIP_FILE=$(basename "$ZIP_PATH")
    echo "   找到 ZIP: $ZIP_FILE"
  else
    echo "   ⚠️  未找到 ZIP 文件"
    echo "      macOS 自动更新需要 ZIP 文件。请使用以下命令构建:"
    echo "      cd $(dirname "$SCRIPT_DIR") && electron-builder --config electron-builder.mjs --mac dmg zip --c.mac.notarize=false -c.mac.identity=null"
  fi

  # 从文件名提取版本号
  if [ -z "$VERSION" ] && [ -n "$DMG_FILE" ]; then
    VERSION=$(echo "$DMG_FILE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+-(alpha|beta|rc|nightly|canary)\.[0-9]+' | head -1)
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

if [ "$ALL_CHANNELS" = true ]; then
  echo ""
  echo "📡 为所有渠道生成 manifest..."

  # stable: 使用基础版本号
  STABLE_VER="$VERSION"
  # nightly: 版本号 +1 patch，加 nightly 后缀
  MAJOR=$(echo "$VERSION" | cut -d. -f1)
  MINOR=$(echo "$VERSION" | cut -d. -f2)
  PATCH=$(echo "$VERSION" | cut -d. -f3 | cut -d- -f1)
  NIGHTLY_VER="$MAJOR.$MINOR.$((PATCH + 1))-nightly.$(date +%Y%m%d)"
  # canary: 版本号 +1 patch，加 canary 后缀
  CANARY_VER="$MAJOR.$MINOR.$((PATCH + 1))-canary.1"

  STABLE_NOTES="## v$STABLE_VER (Stable)

稳定版本，适合日常使用。

### 测试要点
- 从 Nightly/Canary 切换到 Stable 应触发降级更新
- allowDowngrade 应自动设为 true"

  NIGHTLY_NOTES="## v$NIGHTLY_VER (Nightly)

每日构建版本，包含最新功能。

### 测试要点
- 从 Stable 切换到 Nightly 应检测到此版本
- allowPrerelease 应自动设为 true"

  CANARY_NOTES="## v$CANARY_VER (Canary)

最前沿版本，每次 PR 合并后构建。

### 测试要点
- 从 Stable/Nightly 切换到 Canary 应检测到此版本
- 从 Canary 切换回其他渠道应触发降级"

  generate_for_channel "stable" "$STABLE_VER" "$DMG_FILE" "$ZIP_FILE" "$STABLE_NOTES" "$DMG_PATH" "$ZIP_PATH"
  generate_for_channel "nightly" "$NIGHTLY_VER" "$DMG_FILE" "$ZIP_FILE" "$NIGHTLY_NOTES" "$DMG_PATH" "$ZIP_PATH"
  generate_for_channel "canary" "$CANARY_VER" "$DMG_FILE" "$ZIP_FILE" "$CANARY_NOTES" "$DMG_PATH" "$ZIP_PATH"
else
  if [ -z "$RELEASE_NOTES" ]; then
    RELEASE_NOTES="## 🎉 v$VERSION 本地测试版本

这是一个用于本地测试更新功能的模拟版本。

### ✨ 新功能
- 测试自动更新功能
- 验证更新流程

### 🐛 修复
- 本地测试环境配置"
  fi

  echo "   渠道: $CHANNEL"
  generate_for_channel "$CHANNEL" "$VERSION" "$DMG_FILE" "$ZIP_FILE" "$RELEASE_NOTES" "$DMG_PATH" "$ZIP_PATH"
fi

# 显示目录结构
echo ""
echo "📁 服务器目录结构:"
find "$SERVER_DIR" -type f -name "*.yml" | sed "s|$SERVER_DIR/||" | sort
echo ""

echo "✅ 完成！"
echo ""
echo "下一步:"
echo "  1. 启动服务器: ./start-server.sh"
echo "  2. 运行测试:   ./run-test.sh"
echo "  或手动:"
echo "  3. 设置环境变量: UPDATE_SERVER_URL=http://localhost:8787"
echo "  4. 运行应用:     cd ../.. && bun run dev"

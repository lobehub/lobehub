#!/usr/bin/env bash

set -Eeuo pipefail

# Run in the existing Compose deployment directory, or next to this script.
# Interactive: bash deploy-custom-image.sh
# Automation:  IMAGE=ghcr.io/lichao0223/lobehub TAG=main bash deploy-custom-image.sh --non-interactive
# The managed standard override persists the choice for subsequent docker compose commands.

fail() { echo "错误：$*" >&2; exit 1; }
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INTERACTIVE=true
case "${1:-}" in
  --non-interactive) INTERACTIVE=false ;;
  --help|-h)
    echo '在部署目录运行：bash deploy-custom-image.sh'
    echo '可设置 DEPLOY_DIR、COMPOSE_FILE、SERVICE、IMAGE、TAG。'
    echo '自动运行：TAG=main bash deploy-custom-image.sh --non-interactive'
    exit 0 ;;
  '') [[ -t 0 ]] || INTERACTIVE=false ;;
  *) fail "未知参数：$1" ;;
esac

find_compose() {
  local candidate
  for candidate in compose.yaml compose.yml docker-compose.yml docker-compose.yaml; do
    if [[ -f "$1/$candidate" ]]; then
      printf '%s\n' "$1/$candidate"
      return 0
    fi
  done
  return 1
}

if [[ -n "${COMPOSE_FILE:-}" ]]; then
  [[ "$COMPOSE_FILE" != *:* ]] || fail 'COMPOSE_FILE 只支持一个 Compose 文件。'
  [[ -f "$COMPOSE_FILE" ]] || fail "找不到 Compose 文件：$COMPOSE_FILE"
  COMPOSE_FILE="$(cd -- "$(dirname -- "$COMPOSE_FILE")" && pwd)/$(basename -- "$COMPOSE_FILE")"
  DEPLOY_DIR="${DEPLOY_DIR:-$(dirname -- "$COMPOSE_FILE")}"
elif [[ -n "${DEPLOY_DIR:-}" ]]; then
  COMPOSE_FILE="$(find_compose "$DEPLOY_DIR")" || fail "该目录没有 Compose 文件：$DEPLOY_DIR"
elif COMPOSE_FILE="$(find_compose "$PWD")"; then
  DEPLOY_DIR="$PWD"
elif COMPOSE_FILE="$(find_compose "$SCRIPT_DIR")"; then
  DEPLOY_DIR="$SCRIPT_DIR"
else
  $INTERACTIVE || fail '没有找到部署目录，请设置 DEPLOY_DIR。'
  read -r -p '请输入现有 Docker Compose 部署目录：' DEPLOY_DIR
  COMPOSE_FILE="$(find_compose "$DEPLOY_DIR")" || fail "该目录没有 Compose 文件：$DEPLOY_DIR"
fi
DEPLOY_DIR="$(cd -- "$DEPLOY_DIR" && pwd)"
COMPOSE_FILE="$(cd -- "$(dirname -- "$COMPOSE_FILE")" && pwd)/$(basename -- "$COMPOSE_FILE")"
[[ "$(dirname -- "$COMPOSE_FILE")" == "$DEPLOY_DIR" ]] || fail 'DEPLOY_DIR 必须是 Compose 文件所在目录。'
cd -- "$DEPLOY_DIR"
command -v docker >/dev/null 2>&1 || fail '请先安装 Docker。'
docker compose version >/dev/null || fail '请先安装 Docker Compose 插件。'

# Use the standard auto-loaded override so ordinary `docker compose up` keeps the choice.
case "$(basename -- "$COMPOSE_FILE")" in
  compose.yaml|compose.yml) OVERRIDE_FILE="$DEPLOY_DIR/compose.override.yaml" ;;
  *) OVERRIDE_FILE="$DEPLOY_DIR/docker-compose.override.yml" ;;
esac
MARKER='# Managed by deploy-custom-image.sh'
for existing in compose.override.yaml compose.override.yml docker-compose.override.yaml docker-compose.override.yml; do
  if [[ -f "$existing" ]]; then
    [[ "$DEPLOY_DIR/$existing" == "$OVERRIDE_FILE" && "$(head -n 1 "$existing")" == "$MARKER" ]] ||
      fail "发现已有覆盖文件 ${existing}；为保留你的配置，脚本没有覆盖它。"
  fi
done
BASE=(docker compose --project-directory "$DEPLOY_DIR" -f "$COMPOSE_FILE")
SERVICES="$("${BASE[@]}" config --services)"
SERVICE="${SERVICE:-lobe}"
if ! printf '%s\n' "$SERVICES" | grep -Fxq -- "$SERVICE"; then
  $INTERACTIVE || fail "找不到服务 ${SERVICE}，请设置 SERVICE。"
  printf '可用服务：\n%s\n' "$SERVICES"
  read -r -p '请输入 LobeHub 应用服务名：' SERVICE
  printf '%s\n' "$SERVICES" | grep -Fxq -- "$SERVICE" || fail '服务不存在。'
fi
[[ "$SERVICE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || fail '服务名格式无效。'

CURRENT_IMAGE=''
if [[ -f "$OVERRIDE_FILE" ]]; then
  CURRENT_IMAGE="$(sed -n 's/^    image: "\(.*\)"$/\1/p' "$OVERRIDE_FILE")"
fi
IMAGE="${IMAGE:-${CURRENT_IMAGE%:*}}"
IMAGE="${IMAGE:-ghcr.io/lichao0223/lobehub}"
CURRENT_TAG="${CURRENT_IMAGE##*:}"
TAG="${TAG:-${CURRENT_TAG:-main}}"
if $INTERACTIVE; then
  printf '\n部署目录：%s\n应用服务：%s\n' "$DEPLOY_DIR" "$SERVICE"
  printf '已保存镜像：%s\n\n' "${CURRENT_IMAGE:-尚未切换}"
  echo '1) 更新当前选择的镜像'
  echo '2) 切换到 main'
  echo '3) 切换到 canary'
  echo '4) 自定义镜像和标签（也可切回官方镜像）'
  echo '0) 退出'
  read -r -p '请选择 [1]：' choice
  case "${choice:-1}" in
    1) ;;
    2) TAG=main ;;
    3) TAG=canary ;;
    4)
      read -r -p "镜像仓库 [$IMAGE]：" answer
      IMAGE="${answer:-$IMAGE}"
      read -r -p "镜像标签 [$TAG]：" answer
      TAG="${answer:-$TAG}" ;;
    0) exit 0 ;;
    *) fail '无效选项。' ;;
  esac
fi
[[ "$IMAGE" =~ ^[a-z0-9][a-z0-9./:_-]*$ && "$IMAGE" != *@* ]] || fail '镜像仓库格式无效，请单独填写仓库和标签。'
[[ "$TAG" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || fail '镜像标签格式无效。'
IMAGE_REF="$IMAGE:$TAG"
printf '\n即将部署：%s\n' "$IMAGE_REF"
if $INTERACTIVE; then
  read -r -p '确认拉取镜像并重建应用容器？[y/N]：' answer
  case "$answer" in y|Y|yes|YES) ;; *) echo '已取消。'; exit 0 ;; esac
fi

# Validate and pull using a temporary override before persisting any choice.
TEMP_OVERRIDE="$(mktemp "$DEPLOY_DIR/.lobehub-image.XXXXXX")"
trap 'rm -f "$TEMP_OVERRIDE"' EXIT
cat > "$TEMP_OVERRIDE" <<YAML
$MARKER
services:
  $SERVICE:
    image: "$IMAGE_REF"
YAML
COMPOSE=("${BASE[@]}" -f "$TEMP_OVERRIDE")
"${COMPOSE[@]}" config >/dev/null
if ! "${COMPOSE[@]}" pull "$SERVICE"; then
  echo '镜像拉取失败，尚未更改部署配置。' >&2
  echo '若提示 denied/unauthorized，请检查镜像可见性或执行 docker login ghcr.io。' >&2
  echo '若提示 manifest unknown，请确认该分支镜像已经构建并发布。' >&2
  exit 1
fi
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$BACKUP_DIR"
[[ ! -f "$DEPLOY_DIR/.env" ]] || cp "$DEPLOY_DIR/.env" "$BACKUP_DIR/.env.$STAMP"
[[ ! -f "$OVERRIDE_FILE" ]] || cp "$OVERRIDE_FILE" "$BACKUP_DIR/$(basename -- "$OVERRIDE_FILE").$STAMP"
cp "$TEMP_OVERRIDE" "$OVERRIDE_FILE"
if ! "${COMPOSE[@]}" up -d --no-deps --wait "$SERVICE"; then
  echo '应用未成功启动，请检查以下日志。镜像选择已保存，可再次运行脚本重试或切换。' >&2
  "${COMPOSE[@]}" logs --tail=80 "$SERVICE"
  exit 1
fi
printf '\n部署完成，镜像选择已保存到：%s\n' "$OVERRIDE_FILE"
"${COMPOSE[@]}" ps "$SERVICE"
"${COMPOSE[@]}" logs --tail=40 "$SERVICE"
echo '以后更新：再次运行本脚本，选择 1。'

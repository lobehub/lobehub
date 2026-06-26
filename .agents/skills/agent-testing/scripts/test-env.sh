#!/usr/bin/env bash
# Print the resolved local test environment for agent-testing.
#
# This is intentionally read-only. It mirrors scripts/runWithEnv.mts precedence:
# .env -> .env.$NODE_ENV -> .env.local -> .env.$NODE_ENV.local, then shell env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
NODE_ENV="${NODE_ENV:-development}"

VALUE_APP_URL=""
VALUE_PORT=""
VALUE_SERVER_URL=""
VALUE_AUTH_TRUSTED_ORIGINS=""
VALUE_SPA_PORT=""
VALUE_MOBILE_SPA_PORT=""
VALUE_DESKTOP_PORT=""

SOURCE_APP_URL=""
SOURCE_PORT=""
SOURCE_SERVER_URL=""
SOURCE_AUTH_TRUSTED_ORIGINS=""
SOURCE_SPA_PORT=""
SOURCE_MOBILE_SPA_PORT=""
SOURCE_DESKTOP_PORT=""

LOADED_ENV_FILES=""

keys() {
  printf '%s\n' \
    APP_URL \
    PORT \
    SERVER_URL \
    AUTH_TRUSTED_ORIGINS \
    SPA_PORT \
    MOBILE_SPA_PORT \
    DESKTOP_PORT
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

workspace_root() {
  local root="$REPO_ROOT"
  local name
  name="$(basename "$root")"

  if [[ "$name" == "lobehub" ]]; then
    local parent parent_name
    parent="$(cd "$root/.." && pwd)"
    parent_name="$(basename "$parent")"
    if [[ "$parent_name" == lobehub-cloud* ]]; then
      root="$parent"
    fi
  fi

  printf '%s\n' "$root"
}

workspace_offset() {
  local name="$1"

  case "$name" in
    lobehub-cloud)
      printf '0\n'
      ;;
    lobehub-cloud-*)
      local suffix="${name#lobehub-cloud-}"
      if [[ "$suffix" =~ ^[0-9]+$ ]]; then
        printf '%s\n' "$((10#$suffix))"
      else
        printf '\n'
      fi
      ;;
    *)
      printf '\n'
      ;;
  esac
}

default_port() {
  local base="$1"
  local fallback="$2"
  local root name offset
  root="$(workspace_root)"
  name="$(basename "$root")"
  offset="$(workspace_offset "$name")"

  if [[ -n "$offset" ]]; then
    printf '%s\n' "$((base + offset))"
  else
    printf '%s\n' "$fallback"
  fi
}

url_port() {
  local url="$1"
  local hostport
  hostport="${url#*://}"
  hostport="${hostport%%/*}"

  if [[ "$hostport" == *:* ]]; then
    local port="${hostport##*:}"
    if [[ "$port" =~ ^[0-9]+$ ]]; then
      printf '%s\n' "$port"
      return 0
    fi
  fi

  return 1
}

url_origin() {
  local url="$1"
  local scheme rest hostport
  if [[ "$url" == *"://"* ]]; then
    scheme="${url%%://*}"
    rest="${url#*://}"
    hostport="${rest%%/*}"
    printf '%s://%s\n' "$scheme" "$hostport"
  else
    printf '%s\n' "$url"
  fi
}

set_value() {
  local key="$1"
  local value="$2"
  local source="$3"

  case "$key" in
    APP_URL) VALUE_APP_URL="$value"; SOURCE_APP_URL="$source" ;;
    PORT) VALUE_PORT="$value"; SOURCE_PORT="$source" ;;
    SERVER_URL) VALUE_SERVER_URL="$value"; SOURCE_SERVER_URL="$source" ;;
    AUTH_TRUSTED_ORIGINS) VALUE_AUTH_TRUSTED_ORIGINS="$value"; SOURCE_AUTH_TRUSTED_ORIGINS="$source" ;;
    SPA_PORT) VALUE_SPA_PORT="$value"; SOURCE_SPA_PORT="$source" ;;
    MOBILE_SPA_PORT) VALUE_MOBILE_SPA_PORT="$value"; SOURCE_MOBILE_SPA_PORT="$source" ;;
    DESKTOP_PORT) VALUE_DESKTOP_PORT="$value"; SOURCE_DESKTOP_PORT="$source" ;;
  esac
}

value_for() {
  case "$1" in
    APP_URL) printf '%s\n' "$VALUE_APP_URL" ;;
    PORT) printf '%s\n' "$VALUE_PORT" ;;
    SERVER_URL) printf '%s\n' "$VALUE_SERVER_URL" ;;
    AUTH_TRUSTED_ORIGINS) printf '%s\n' "$VALUE_AUTH_TRUSTED_ORIGINS" ;;
    SPA_PORT) printf '%s\n' "$VALUE_SPA_PORT" ;;
    MOBILE_SPA_PORT) printf '%s\n' "$VALUE_MOBILE_SPA_PORT" ;;
    DESKTOP_PORT) printf '%s\n' "$VALUE_DESKTOP_PORT" ;;
  esac
}

source_for() {
  case "$1" in
    APP_URL) printf '%s\n' "$SOURCE_APP_URL" ;;
    PORT) printf '%s\n' "$SOURCE_PORT" ;;
    SERVER_URL) printf '%s\n' "$SOURCE_SERVER_URL" ;;
    AUTH_TRUSTED_ORIGINS) printf '%s\n' "$SOURCE_AUTH_TRUSTED_ORIGINS" ;;
    SPA_PORT) printf '%s\n' "$SOURCE_SPA_PORT" ;;
    MOBILE_SPA_PORT) printf '%s\n' "$SOURCE_MOBILE_SPA_PORT" ;;
    DESKTOP_PORT) printf '%s\n' "$SOURCE_DESKTOP_PORT" ;;
  esac
}

is_tracked_key() {
  case "$1" in
    APP_URL|PORT|SERVER_URL|AUTH_TRUSTED_ORIGINS|SPA_PORT|MOBILE_SPA_PORT|DESKTOP_PORT) return 0 ;;
    *) return 1 ;;
  esac
}

parse_env_file() {
  local file="$1"
  local root="$2"
  local label="${file#$root/}"
  local line key value

  [[ -f "$file" ]] || return 0
  if [[ -z "$LOADED_ENV_FILES" ]]; then
    LOADED_ENV_FILES="$label"
  else
    LOADED_ENV_FILES="$LOADED_ENV_FILES, $label"
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="$(trim "$line")"
    [[ -z "$line" || "$line" == \#* ]] && continue

    if [[ "$line" == export[[:space:]]* ]]; then
      line="$(trim "${line#export}")"
    fi

    [[ "$line" == *=* ]] || continue
    key="$(trim "${line%%=*}")"
    value="$(trim "${line#*=}")"
    is_tracked_key "$key" || continue

    if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'* && "$value" == *\' && ${#value} -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    fi

    set_value "$key" "$value" "$label"
  done < "$file"
}

apply_env_files() {
  local root="$1"
  parse_env_file "$root/.env" "$root"
  parse_env_file "$root/.env.$NODE_ENV" "$root"
  parse_env_file "$root/.env.local" "$root"
  parse_env_file "$root/.env.$NODE_ENV.local" "$root"
}

apply_shell_overrides() {
  local key value
  while IFS= read -r key; do
    if [[ -n "${!key+x}" ]]; then
      value="${!key}"
      set_value "$key" "$value" "shell"
    fi
  done < <(keys)
}

# Read the ports auto-allocated by init-dev-env.sh (.records/env/agent-testing-ports.env)
# so test-env / setup-auth target the exact port the dev server actually bound to.
# Lower priority than explicit .env / shell, higher than the workspace-offset default.
apply_ports_file() {
  local root="$1"
  local file="${AGENT_TESTING_PORTS_FILE:-$root/.records/env/agent-testing-ports.env}"
  [[ -f "$file" ]] || return 0
  local ss sp
  ss="$(grep -E '^ALLOC_SERVER_PORT=' "$file" 2> /dev/null | tail -1 | cut -d= -f2 || true)"
  sp="$(grep -E '^ALLOC_SPA_PORT=' "$file" 2> /dev/null | tail -1 | cut -d= -f2 || true)"
  if [[ -n "$ss" ]]; then
    [[ -z "$VALUE_PORT" ]] && set_value PORT "$ss" "ports-file"
    [[ -z "$VALUE_APP_URL" ]] && set_value APP_URL "http://localhost:$ss" "ports-file"
  fi
  if [[ -n "$sp" && -z "$VALUE_SPA_PORT" ]]; then
    set_value SPA_PORT "$sp" "ports-file"
  fi
}

resolve_defaults() {
  local app_port spa_port mobile_spa_port desktop_port
  app_port="$(default_port 3020 3010)"
  spa_port="$(default_port 9800 9876)"
  mobile_spa_port="$(default_port 3810 3012)"
  desktop_port="$(default_port 3030 3015)"

  if [[ -z "$VALUE_APP_URL" ]]; then
    set_value APP_URL "http://localhost:$app_port" "inferred"
  fi

  if [[ -z "$VALUE_PORT" ]]; then
    if app_port="$(url_port "$VALUE_APP_URL")"; then
      set_value PORT "$app_port" "inferred from APP_URL"
    else
      set_value PORT "$(default_port 3020 3010)" "inferred"
    fi
  fi

  if [[ -z "$VALUE_SERVER_URL" ]]; then
    set_value SERVER_URL "$VALUE_APP_URL" "from APP_URL"
  fi

  if [[ -z "$VALUE_SPA_PORT" ]]; then
    set_value SPA_PORT "$spa_port" "inferred"
  fi

  if [[ -z "$VALUE_MOBILE_SPA_PORT" ]]; then
    set_value MOBILE_SPA_PORT "$mobile_spa_port" "inferred"
  fi

  if [[ -z "$VALUE_DESKTOP_PORT" ]]; then
    set_value DESKTOP_PORT "$desktop_port" "inferred"
  fi

  if [[ -z "$VALUE_AUTH_TRUSTED_ORIGINS" ]]; then
    set_value AUTH_TRUSTED_ORIGINS "$(url_origin "$VALUE_APP_URL"),http://localhost:$VALUE_SPA_PORT" "inferred"
  fi
}

contains_origin() {
  local list="$1"
  local expected="$2"
  local item
  IFS=',' read -r -a items <<< "$list"
  for item in "${items[@]}"; do
    item="$(trim "$item")"
    [[ "$item" == "$expected" ]] && return 0
  done
  return 1
}

print_exports() {
  local key value
  while IFS= read -r key; do
    value="$(value_for "$key")"
    printf 'export %s=%q\n' "$key" "$value"
  done < <(keys)
}

print_value() {
  local key="$1"
  if ! is_tracked_key "$key"; then
    echo "unknown key: $key" >&2
    exit 2
  fi
  value_for "$key"
}

print_human() {
  local root="$1"
  local key value source

  echo "agent-testing test env:"
  printf '  workspace: %s\n' "$root"
  printf '  NODE_ENV: %s\n' "$NODE_ENV"
  printf '  env files: %s\n' "${LOADED_ENV_FILES:-none}"
  echo
  echo "resolved values:"
  while IFS= read -r key; do
    value="$(value_for "$key")"
    source="$(source_for "$key")"
    printf '  %-22s %s  (%s)\n' "$key=$value" "" "$source"
  done < <(keys)
  echo
  echo "checks:"

  local app_origin spa_origin app_port
  app_origin="$(url_origin "$VALUE_APP_URL")"
  spa_origin="http://localhost:$VALUE_SPA_PORT"
  if app_port="$(url_port "$VALUE_APP_URL")" && [[ "$app_port" == "$VALUE_PORT" ]]; then
    printf '  OK   PORT matches APP_URL (%s)\n' "$VALUE_PORT"
  else
    printf '  WARN PORT (%s) does not match APP_URL (%s)\n' "$VALUE_PORT" "$VALUE_APP_URL"
  fi

  if contains_origin "$VALUE_AUTH_TRUSTED_ORIGINS" "$app_origin"; then
    printf '  OK   AUTH_TRUSTED_ORIGINS includes %s\n' "$app_origin"
  else
    printf '  WARN AUTH_TRUSTED_ORIGINS is missing %s\n' "$app_origin"
  fi

  if contains_origin "$VALUE_AUTH_TRUSTED_ORIGINS" "$spa_origin"; then
    printf '  OK   AUTH_TRUSTED_ORIGINS includes %s\n' "$spa_origin"
  else
    printf '  WARN AUTH_TRUSTED_ORIGINS is missing %s\n' "$spa_origin"
  fi
}

usage() {
  cat << EOF
Usage:
  $0                 # print resolved test environment
  $0 --exports       # print source-able export lines
  $0 --value KEY     # print one resolved value

Tracked keys:
  APP_URL PORT SERVER_URL AUTH_TRUSTED_ORIGINS SPA_PORT MOBILE_SPA_PORT DESKTOP_PORT
EOF
}

ROOT="$(workspace_root)"
apply_env_files "$ROOT"
apply_shell_overrides
apply_ports_file "$ROOT"
resolve_defaults

case "${1:-}" in
  "")
    print_human "$ROOT"
    ;;
  --exports)
    print_exports
    ;;
  --value)
    print_value "${2:-}"
    ;;
  -h|--help)
    usage
    ;;
  *)
    echo "unknown option: $1" >&2
    usage >&2
    exit 2
    ;;
esac

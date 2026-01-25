#!/bin/bash

# ==================
# == Env settings ==
# ==================

# check operating system
# ref: https://github.com/lobehub/lobe-chat/pull/5247
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    SED_INPLACE_ARGS=('-i' '')
else
    # not macOS
    SED_INPLACE_ARGS=('-i')
fi

# ======================
# == Process the args ==
# ======================

# 1. Default values of arguments

# Arg: -l or --lang
# Determine the language to show, default is en

# Arg: --url
# Determine the source URL to download files
SOURCE_URL="https://raw.githubusercontent.com/lobehub/lobe-chat/main"

# Arg: --host
# Determine the server host
HOST=""

# 2. Parse script arguments
while getopts "l:-:" opt; do
    case $opt in
        l)
            LANGUAGE=$OPTARG
        ;;
        -)
            case "${OPTARG}" in
                lang)
                    LANGUAGE="${!OPTIND}"
                    OPTIND=$(($OPTIND + 1))
                ;;
                url)
                    SOURCE_URL="${!OPTIND}"
                    OPTIND=$(($OPTIND + 1))
                ;;
                host)
                    HOST="${!OPTIND}"
                    OPTIND=$(($OPTIND + 1))
                ;;
                *)
                    echo "Usage: $0 [-l language|--lang language] [--url source] [--host serverhost]" >&2
                    exit 1
                ;;
            esac
        ;;
        *)
            echo "Usage: $0 [-l language|--lang language] [--url source]" >&2
            exit 1
        ;;
    esac
done

#######################
## Helper Functions ##
#######################

# Supported languages and messages
# Arg: -l --lang
# If the language is not supported, default to English
# Function to show messages
show_message() {
    local key="$1"
    case $key in
        choose_language)
            echo "Please choose a language / 请选择语言:"
            echo "(0) English"
            echo "(1) 简体中文"
        ;;
        downloading)
            case $LANGUAGE in
                zh_CN)
                    echo "正在下载文件..."
                ;;
                *)
                    echo "Downloading files..."
                ;;
            esac
        ;;
        extracted_success)
            case $LANGUAGE in
                zh_CN)
                    echo " 解压成功到目录："
                ;;
                *)
                    echo " extracted successfully to directory: "
                ;;
            esac
        ;;
        extracted_failed)
            case $LANGUAGE in
                zh_CN)
                    echo " 解压失败。"
                ;;
                *)
                    echo " extraction failed."
                ;;
            esac
        ;;
        file_not_exists)
            case $LANGUAGE in
                zh_CN)
                    echo " 不存在。"
                ;;
                *)
                    echo " does not exist."
                ;;
            esac
        ;;
        security_secrect_regenerate)
            case $LANGUAGE in
                zh_CN)
                    echo "重新生成安全密钥..."
                ;;
                *)
                    echo "Regenerate security secrets..."
                ;;
            esac
        ;;
        security_secrect_regenerate_failed)
            case $LANGUAGE in
                zh_CN)
                    echo "无法重新生成安全密钥："
                ;;
                *)
                    echo "Failed to regenerate security secrets: "
                ;;
            esac
        ;;
        host_regenerate)
            case $LANGUAGE in
                zh_CN)
                    echo "✔️ 已更新部署模式配置"
                ;;
                *)
                    echo "✔️ Updated deployment mode configuration"
                ;;
            esac
        ;;
        host_regenerate_failed)
            case $LANGUAGE in
                zh_CN)
                    echo "无法重新生成服务器域名："
                ;;
                *)
                    echo "Failed to regenerate server host: "
                ;;
            esac
        ;;
        security_secrect_regenerate_report)
            case $LANGUAGE in
                zh_CN)
                    echo "安全密钥生成结果如下："
                ;;
                *)
                    echo "Security secret generation results are as follows:"
                ;;
            esac
        ;;
        tips_download_failed)
            case $LANGUAGE in
                zh_CN)
                    echo "$2 下载失败，请检查网络连接。"
                ;;
                *)
                    echo "$2 Download failed, please check the network connection."
                ;;
            esac
        ;;
        tips_already_installed)
            case $LANGUAGE in
                zh_CN)
                    echo "检测到您已经运行过 LobeChat Database，本安装程序只能完成初始化配置，并不能重复安装。如果你需要重新安装，请删除 data 和 s3_data 文件夹。"
                ;;
                *)
                    echo "It is detected that you have run LobeChat Database. This installation program can only complete the initialization configuration and cannot be reinstalled. If you need to reinstall, please delete the data and s3_data folders."
                ;;
            esac
        ;;
        tips_run_command)
            case $LANGUAGE in
                zh_CN)
                    echo "您已经完成了所有配置。请运行以下命令启动LobeChat："
                ;;
                *)
                    echo "You have completed all configurations. Please run this command to start LobeChat:"
                ;;
            esac
        ;;
        tips_show_documentation)
            case $LANGUAGE in
                zh_CN)
                    echo "完整的环境变量在'.env'中可以在文档中找到："
                ;;
                *)
                    echo "Full environment variables in the '.env' can be found at the documentation on "
                ;;
            esac
        ;;
        tips_show_documentation_url)
            case $LANGUAGE in
                zh_CN)
                    echo "https://lobehub.com/zh/docs/self-hosting/environment-variables"
                ;;
                *)
                    echo "https://lobehub.com/docs/self-hosting/environment-variables"
                ;;
            esac
        ;;
        dev_dirs_exist)
            case $LANGUAGE in
                zh_CN)
                    echo "检测到开发数据目录存在："
                ;;
                *)
                    echo "Detected existing development data directories:"
                ;;
            esac
        ;;
        dev_dirs_delete_warning)
            case $LANGUAGE in
                zh_CN)
                    echo "是否删除上述目录以继续？此操作将清空相关持久化数据。"
                ;;
                *)
                    echo "Do you want to delete the directories above to continue? This will remove persisted data."
                ;;
            esac
        ;;
        dev_dirs_abort)
            case $LANGUAGE in
                zh_CN)
                    echo "用户取消删除。无法继续进行开发环境初始化。"
                ;;
                *)
                    echo "Deletion declined by user. Cannot proceed with development setup."
                ;;
            esac
        ;;
        dev_dirs_deleting)
            case $LANGUAGE in
                zh_CN)
                    echo "正在删除目录："
                ;;
                *)
                    echo "Deleting directories:"
                ;;
            esac
        ;;
        dev_dirs_deleted)
            case $LANGUAGE in
                zh_CN)
                    echo "目录已删除。"
                ;;
                *)
                    echo "Directories deleted."
                ;;
            esac
        ;;
        tips_no_executable)
            case $LANGUAGE in
                zh_CN)
                    echo "没有找到，请先安装。"
                ;;
                *)
                    echo "not found, please install it first."
                ;;
            esac
        ;;
        tips_allow_ports)
            case $LANGUAGE in
                zh_CN)
                    echo "请确保服务器以下端口未被占用且能被访问：3210, 9000, 9001, 8000"
                ;;
                *)
                    echo "Please make sure the following ports on the server are not occupied and can be accessed: 3210, 9000, 9001, 8000"
                ;;
            esac
        ;;
        tips_auto_detected)
            case $LANGUAGE in
                zh_CN)
                    echo "已自动识别"
                ;;
                *)
                    echo "Auto-detected"
                ;;
            esac
        ;;
        tips_private_ip_detected)
            case $LANGUAGE in
                zh_CN)
                    echo "注意，当前识别到内网 IP，如果需要外部访问，请替换为公网 IP 地址"
                ;;
                *)
                    echo "Note that the current internal IP is detected. If you need external access, please replace it with the public IP address."
                ;;
            esac
        ;;
        tips_add_reverse_proxy)
            case $LANGUAGE in
                zh_CN)
                    echo "请在你的反向代理中完成域名到端口的映射："
                ;;
                *)
                    echo "Please complete the mapping of domain to port in your reverse proxy:"
                ;;
            esac
        ;;
        tips_no_docker_permission)
            case $LANGUAGE in
                zh_CN)
                    echo "WARN: 看起来当前用户没有 Docker 权限。"
                    echo "使用 'sudo usermod -aG docker $USER' 为用户分配 Docker 权限（可能需要重新启动 shell）。"
                ;;
                *)
                    echo "WARN: It look like the current user does not have Docker permissions."
                    echo "Use 'sudo usermod -aG docker $USER' to assign Docker permissions to the user (may require restarting shell)."
                ;;
            esac
        ;;
        tips_init_database_failed)
            case $LANGUAGE in
                zh_CN)
                    echo "无法初始化数据库，为了避免你的数据重复初始化，请在首次成功启动时运行以下指令清空 Casdoor 初始配置文件："
                    echo "echo '{}' > init_data.json"
                ;;
                *)
                    echo "Failed to initialize the database. To avoid your data being initialized repeatedly, run the following command to unmount the initial configuration file of Casdoor when you first start successfully:"
                    echo "echo '{}' > init_data.json"
                ;;
            esac
        ;;
        ask_regenerate_secrets)
            case $LANGUAGE in
                zh_CN)
                    echo "是否要重新生成安全密钥？"
                ;;
                *)
                    echo "Do you want to regenerate security secrets?"
                ;;
            esac
        ;;
        ask_deploy_mode)
            case $LANGUAGE in
                zh_CN)
                    echo "请选择部署模式："
                    echo "(0) 域名模式（访问时无需指明端口），需要使用反向代理服务 LobeChat, MinIO, Casdoor ，并分别分配一个域名；"
                    echo "(1) 端口模式（访问时需要指明端口，如使用IP访问，或域名+端口访问），需要放开指定端口；"
                    echo "(2) 本地模式（仅供本地测试使用）"
                    echo "(3) 开发模式（仅启动本地开发所需的基础服务，不包含 Casdoor；将 .env 复制到项目根目录）"
                    echo "如果你对这些内容疑惑，可以先选择使用本地模式进行部署，稍后根据文档指引再进行修改。"
                    echo "https://lobehub.com/docs/self-hosting/server-database/docker-compose"
                ;;
                *)
                    echo "Please select the deployment mode:"
                    echo "(0) Domain mode (no need to specify the port when accessing), you need to use the reverse proxy service LobeChat, MinIO, Casdoor, and assign a domain name respectively;"
                    echo "(1) Port mode (need to specify the port when accessing, such as using IP access, or domain name + port access), you need to open the specified port;"
                    echo "(2) Local mode (for local testing only)"
                    echo "(3) Development mode (start local dev infra only, no Casdoor; copy .env to project root)"
                    echo "If you are confused about these contents, you can choose to deploy in local mode first, and then modify according to the document guide later."
                    echo "https://lobehub.com/docs/self-hosting/server-database/docker-compose"
                ;;
            esac
        ;;
        ask_host)
            case $LANGUAGE in
                zh_CN)
                    echo " 部署IP/域名"
                ;;
                *)
                    echo " Deploy IP/Domain"
                ;;
            esac
        ;;
        ask_domain)
            case $LANGUAGE in
                zh_CN)
                    echo "服务的域名（例如 $2 ，不要包含协议前缀）："
                ;;
                *)
                    echo "The domain of the service (e.g. $2, do not include the protocol prefix):"
                ;;
            esac
        ;;
        ask_protocol)
            case $LANGUAGE in
                zh_CN)
                    echo "域名是否使用 https 协议？ (所有服务需要使用同一协议)"
                ;;
                *)
                    echo "Does the domain use the https protocol? (All services need to use the same protocol)"
                ;;
            esac
        ;;
        ask_init_database)
            case $LANGUAGE in
                zh_CN)
                    echo "是否初始化数据库？"
                ;;
                *)
                    echo "Do you want to initialize the database?"
                ;;
            esac
        ;;
    esac
}

# Function to download files
download_file() {
    wget --show-progress "$1" -O "$2"
    # If run failed, exit
    if [ $? -ne 0 ]; then
        show_message "tips_download_failed" "$2"
        exit 1
    fi
}

print_centered() {
    # Map color name to ANSI code without associative arrays (macOS bash 3.2 compatible)
    local text="$1"
    local color="${2:-reset}"
    local color_code
    case "$color" in
        black)   color_code="\e[30m" ;;
        red)     color_code="\e[31m" ;;
        green)   color_code="\e[32m" ;;
        yellow)  color_code="\e[33m" ;;
        blue)    color_code="\e[34m" ;;
        magenta) color_code="\e[35m" ;;
        cyan)    color_code="\e[36m" ;;
        white)   color_code="\e[37m" ;;
        reset|*) color_code="\e[0m" ;;
    esac
    # Determine terminal width (fallback to 80)
    local term_width
    term_width=$(tput cols 2>/dev/null || echo 80)
    local text_length=${#text}
    local padding=$(((term_width - text_length) / 2))
    if [ $padding -lt 0 ]; then padding=0; fi
    printf "%*s${color_code}%s\e[0m\n" $padding "" "$text"
}

# Usage:
# ```sh
#   ask "prompt" "default" "description"
#   echo $ask_result
# ```
#   "prompt" ["description" "default"]:
ask() {
    local prompt="$1"
    local default="$2"
    local description="$3"
    # Add a space after the description if it is not empty
    if [ -n "$description" ]; then
        description="$description "
    fi
    local result

    if [ -n "$default" ]; then
        read -p "$prompt [${description}${default}]: " result
        result=${result:-$default}
    else
        read -p "$prompt: " result
    fi
    # trim and assign to global variable
    ask_result=$(echo "$result" | xargs)
}

####################
## Main Process ##
####################

# ===============
# == Variables ==
# ===============
# File list
SUB_DIR="docker-compose/local"
FILES=(
    "$SUB_DIR/docker-compose.yml"
    "$SUB_DIR/init_data.json"
    "$SUB_DIR/searxng-settings.yml"
)
ENV_EXAMPLES=(
    "$SUB_DIR/.env.zh-CN.example"
    "$SUB_DIR/.env.example"
)
# Default values
CASDOOR_PASSWORD="pswd123"
CASDOOR_SECRET="CASDOOR_SECRET"
MINIO_ROOT_PASSWORD="YOUR_MINIO_PASSWORD"
CASDOOR_HOST="localhost:8000"
MINIO_HOST="localhost:9000"
PROTOCOL="http"

# If no language is specified, ask the user to choose
if [ -z "$LANGUAGE" ]; then
    show_message "choose_language"
    ask "(0,1)" "0"
    case $ask_result in
        0)
            LANGUAGE="en_US"
        ;;
        1)
            LANGUAGE="zh_CN"
        ;;
        *)
            echo "Invalid language: $ask_result"
            exit 1
        ;;
    esac
fi

# ==========================
# === Development Mode  ====
# ==========================
sync_dev_s3_env_from_minio() {
    local SCRIPT_DIR
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local PROJECT_ROOT
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    local DEST_ENV="$PROJECT_ROOT/.env"

    if [ ! -f "$DEST_ENV" ]; then
        return 0
    fi

    local MINIO_BUCKET MINIO_USER MINIO_PASS
    MINIO_BUCKET=$(grep -E '^MINIO_LOBE_BUCKET=' "$DEST_ENV" | head -n1 | cut -d'=' -f2)
    MINIO_USER=$(grep -E '^MINIO_ROOT_USER=' "$DEST_ENV" | head -n1 | cut -d'=' -f2)
    MINIO_PASS=$(grep -E '^MINIO_ROOT_PASSWORD=' "$DEST_ENV" | head -n1 | cut -d'=' -f2)

    # Defaults when missing
    if [ -z "$MINIO_BUCKET" ]; then MINIO_BUCKET="lobe"; fi
    if [ -z "$MINIO_USER" ]; then MINIO_USER="admin"; fi

    if grep -q '^S3_BUCKET=' "$DEST_ENV"; then
        sed "${SED_INPLACE_ARGS[@]}" "s#^S3_BUCKET=.*#S3_BUCKET=${MINIO_BUCKET}#" "$DEST_ENV"
    else
        echo "S3_BUCKET=${MINIO_BUCKET}" >> "$DEST_ENV"
    fi
    if grep -q '^S3_ACCESS_KEY=' "$DEST_ENV"; then
        sed "${SED_INPLACE_ARGS[@]}" "s#^S3_ACCESS_KEY=.*#S3_ACCESS_KEY=${MINIO_USER}#" "$DEST_ENV"
    else
        echo "S3_ACCESS_KEY=${MINIO_USER}" >> "$DEST_ENV"
    fi
    if grep -q '^S3_ACCESS_KEY_ID=' "$DEST_ENV"; then
        sed "${SED_INPLACE_ARGS[@]}" "s#^S3_ACCESS_KEY_ID=.*#S3_ACCESS_KEY_ID=${MINIO_USER}#" "$DEST_ENV"
    else
        echo "S3_ACCESS_KEY_ID=${MINIO_USER}" >> "$DEST_ENV"
    fi
    if grep -q '^S3_SECRET_ACCESS_KEY=' "$DEST_ENV"; then
        sed "${SED_INPLACE_ARGS[@]}" "s#^S3_SECRET_ACCESS_KEY=.*#S3_SECRET_ACCESS_KEY=${MINIO_PASS}#" "$DEST_ENV"
    else
        echo "S3_SECRET_ACCESS_KEY=${MINIO_PASS}" >> "$DEST_ENV"
    fi
}

section_setup_development_env() {
    # Determine directories
    local SCRIPT_DIR
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local PROJECT_ROOT
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

    echo "Setting up development environment (.env at project root)..."
    local DEV_ENV_EXAMPLE="$SCRIPT_DIR/development/.env.example"
    local DEST_ENV="$PROJECT_ROOT/.env"

    if [ ! -f "$DEV_ENV_EXAMPLE" ]; then
        echo "ERROR: Development .env.example not found at $DEV_ENV_EXAMPLE"
        return 1
    fi

    local DO_COPY="y"
    if [ -f "$DEST_ENV" ]; then
        echo "A .env already exists at project root ($DEST_ENV). Overwrite?"
        ask "(y/n)" "n"
        DO_COPY="$ask_result"
        if [[ "$DO_COPY" != "y" ]]; then
            echo "Keeping existing .env at project root."
        fi
    fi

    if [[ "$DO_COPY" == "y" ]]; then
        cp "$DEV_ENV_EXAMPLE" "$DEST_ENV"
        if [ $? -ne 0 ]; then
            echo "ERROR: Failed to copy development .env to project root."
            return 1
        fi
        echo "✔️  .env copied to project root: $DEST_ENV"
    fi

    # Sync S3 variables to concrete values from current MinIO settings
    sync_dev_s3_env_from_minio
}

section_check_dev_data_dirs() {
    # Check and optionally delete existing dev data directories (PostgreSQL and MinIO)
    local SCRIPT_DIR
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local DEV_DIR="$SCRIPT_DIR/development"
    local DATA_DIR="$DEV_DIR/data"
    local S3_DATA_DIR="$DEV_DIR/s3_data"

    local existing_list=""
    local -a dirs_to_remove

    if [ -d "$DATA_DIR" ]; then
        existing_list+=" data"
        dirs_to_remove+=("$DATA_DIR")
    fi
    if [ -d "$S3_DATA_DIR" ]; then
        existing_list+=" s3_data"
        dirs_to_remove+=("$S3_DATA_DIR")
    fi

    # Nothing to do
    if [ -z "$existing_list" ]; then
        return 0
    fi

    # Inform user and ask for deletion
    echo "$(show_message "dev_dirs_exist")$existing_list"
    echo "$(show_message "dev_dirs_delete_warning")"
    ask "(y/n)" "n"
    if [[ "$ask_result" != "y" ]]; then
        echo "$(show_message "dev_dirs_abort")"
        return 1
    fi

    echo "$(show_message "dev_dirs_deleting")$existing_list"
    # Delete only within DEV_DIR for safety
    for d in "${dirs_to_remove[@]}"; do
        case "$d" in
            "$DEV_DIR"/*)
                rm -rf -- "$d"
                ;;
            *)
                echo "Skip unsafe path: $d"
                ;;
        esac
    done
    echo "$(show_message "dev_dirs_deleted")"
}

section_regenerate_secrets_dev() {
    # Regenerate development secrets (MinIO, NextAuth, Key Vaults) and DATABASE_URL
    if ! command -v openssl &> /dev/null ; then
        echo "openssl" $(show_message "tips_no_executable")
        return 1
    fi
    if ! command -v sed &> /dev/null ; then
        echo "sed" $(show_message "tips_no_executable")
        return 1
    fi

    generate_key() {
        if [[ -z "$1" ]]; then
            echo "Usage: generate_key <length>"
            return 1
        fi
        echo $(openssl rand -hex $1 | tr -d '\n' | fold -w $1 | head -n 1)
    }

    generate_base64() {
        if [[ -z "$1" ]]; then
            echo "Usage: generate_base64 <bytes>"
            return 1
        fi
        echo $(openssl rand -base64 $1 | tr -d '\n')
    }

    local SCRIPT_DIR
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local PROJECT_ROOT
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    local DEST_ENV="$PROJECT_ROOT/.env"

    if [ ! -f "$DEST_ENV" ]; then
        echo "WARN: $DEST_ENV not found; skipping secret regeneration."
        return 0
    fi

    echo $(show_message "security_secrect_regenerate")

    # 1) MINIO_ROOT_PASSWORD (hex)
    local MINIO_ROOT_PASSWORD
    MINIO_ROOT_PASSWORD=$(generate_key 8)
    if [ $? -ne 0 ] || [ -z "$MINIO_ROOT_PASSWORD" ]; then
        echo $(show_message "security_secrect_regenerate_failed") "MINIO_ROOT_PASSWORD"
        return 1
    fi
    if grep -q '^MINIO_ROOT_PASSWORD=' "$DEST_ENV"; then
        sed "${SED_INPLACE_ARGS[@]}" "s#^MINIO_ROOT_PASSWORD=.*#MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}#" "$DEST_ENV"
    else
        echo "MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}" >> "$DEST_ENV"
    fi

    # 2) POSTGRES_PASSWORD (hex)
    local POSTGRES_PASSWORD_NEW
    POSTGRES_PASSWORD_NEW=$(generate_key 8)
    if [ $? -ne 0 ] || [ -z "$POSTGRES_PASSWORD_NEW" ]; then
        echo $(show_message "security_secrect_regenerate_failed") "POSTGRES_PASSWORD"
    else
        if grep -q '^POSTGRES_PASSWORD=' "$DEST_ENV"; then
            sed "${SED_INPLACE_ARGS[@]}" "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=${POSTGRES_PASSWORD_NEW}#" "$DEST_ENV"
        else
            echo "POSTGRES_PASSWORD=${POSTGRES_PASSWORD_NEW}" >> "$DEST_ENV"
        fi
    fi

    # 3) NEXT_AUTH_SECRET (base64 32)
    local NEXT_AUTH_SECRET
    NEXT_AUTH_SECRET=$(generate_base64 32)
    if [ $? -ne 0 ] || [ -z "$NEXT_AUTH_SECRET" ]; then
        echo $(show_message "security_secrect_regenerate_failed") "NEXT_AUTH_SECRET"
    else
        if grep -q '^NEXT_AUTH_SECRET=' "$DEST_ENV"; then
            sed "${SED_INPLACE_ARGS[@]}" "s#^NEXT_AUTH_SECRET=.*#NEXT_AUTH_SECRET=${NEXT_AUTH_SECRET}#" "$DEST_ENV"
        else
            echo "NEXT_AUTH_SECRET=${NEXT_AUTH_SECRET}" >> "$DEST_ENV"
        fi
    fi

    # 3) KEY_VAULTS_SECRET (base64 32)
    local KEY_VAULTS_SECRET
    KEY_VAULTS_SECRET=$(generate_base64 32)
    if [ $? -ne 0 ] || [ -z "$KEY_VAULTS_SECRET" ]; then
        echo $(show_message "security_secrect_regenerate_failed") "KEY_VAULTS_SECRET"
    else
        if grep -q '^KEY_VAULTS_SECRET=' "$DEST_ENV"; then
            sed "${SED_INPLACE_ARGS[@]}" "s#^KEY_VAULTS_SECRET=.*#KEY_VAULTS_SECRET=${KEY_VAULTS_SECRET}#" "$DEST_ENV"
        else
            echo "KEY_VAULTS_SECRET=${KEY_VAULTS_SECRET}" >> "$DEST_ENV"
        fi
    fi

    # 4) DATABASE_URL (postgres connection string)
    local POSTGRES_PASSWORD_VAL
    local LOBE_DB_NAME_VAL
    POSTGRES_PASSWORD_VAL=$(grep -E '^POSTGRES_PASSWORD=' "$DEST_ENV" | head -n1 | cut -d'=' -f2)
    LOBE_DB_NAME_VAL=$(grep -E '^LOBE_DB_NAME=' "$DEST_ENV" | head -n1 | cut -d'=' -f2)
    if [ -z "$POSTGRES_PASSWORD_VAL" ]; then POSTGRES_PASSWORD_VAL="postgres"; fi
    if [ -z "$LOBE_DB_NAME_VAL" ]; then LOBE_DB_NAME_VAL="lobechat"; fi
    local DATABASE_URL
    DATABASE_URL="postgres://postgres:${POSTGRES_PASSWORD_VAL}@localhost:5432/${LOBE_DB_NAME_VAL}"
    if grep -q '^DATABASE_URL=' "$DEST_ENV"; then
        sed "${SED_INPLACE_ARGS[@]}" "s#^DATABASE_URL=.*#DATABASE_URL=${DATABASE_URL}#" "$DEST_ENV"
    else
        echo "DATABASE_URL=${DATABASE_URL}" >> "$DEST_ENV"
    fi

    # Sync S3 variables to reflect updated MinIO creds
    sync_dev_s3_env_from_minio
}

section_init_database_dev() {
    if ! command -v docker &> /dev/null ; then
        echo "docker" $(show_message "tips_no_executable")
        return 1
    fi
    if ! docker compose &> /dev/null ; then
        echo "docker compose" $(show_message "tips_no_executable")
        return 1
    fi
    if ! docker stats --no-stream &> /dev/null ; then
        echo $(show_message "tips_no_docker_permission")
        return 1
    fi

    local SCRIPT_DIR
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local PROJECT_ROOT
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

    echo "Starting development infrastructure (PostgreSQL, MinIO, SearXNG)..."
    docker compose --env-file "$PROJECT_ROOT/.env" -f "$SCRIPT_DIR/development/docker-compose.yml" pull
    docker compose --env-file "$PROJECT_ROOT/.env" -f "$SCRIPT_DIR/development/docker-compose.yml" up --detach postgresql minio searxng
    # give services a moment to start
    sleep 5
}

section_display_dev_report() {
    local SCRIPT_DIR
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local PROJECT_ROOT
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    local DEST_ENV="$PROJECT_ROOT/.env"

    # Defaults
    local LOBE_PORT_VALUE=3210
    local MINIO_PORT_VALUE=9000

    if [ -f "$DEST_ENV" ]; then
        local lp mp
        lp=$(grep -E '^LOBE_PORT=' "$DEST_ENV" | head -n1 | cut -d'=' -f2)
        mp=$(grep -E '^MINIO_PORT=' "$DEST_ENV" | head -n1 | cut -d'=' -f2)
        if [ -n "$lp" ]; then LOBE_PORT_VALUE="$lp"; fi
        if [ -n "$mp" ]; then MINIO_PORT_VALUE="$mp"; fi
    fi

    printf "\nDevelopment infrastructure started. Service endpoints:\n"
    echo "- PostgreSQL: localhost:5432"
    echo "- MinIO API:  http://localhost:${MINIO_PORT_VALUE} (Console: http://localhost:9001)"
    echo "- SearXNG:    http://localhost:8080"

    printf "\nYou can now run the app locally with:\n"
    print_centered "pnpm db:migrate" "green"
    print_centered "pnpm start:dev" "green"
}

# Prompt for deployment mode early to allow Development mode flow
show_message "ask_deploy_mode"
ask "(0,1,2,3)" "2"
if [[ "$ask_result" == "3" ]]; then
    # Development mode: copy .env to project root, optionally regenerate secrets/init DB, then report and exit
    section_setup_development_env || exit 1

    show_message "ask_regenerate_secrets"
    ask "(y/n)" "y"
    if [[ "$ask_result" == "y" ]]; then
        section_regenerate_secrets_dev || true
    fi

    # Check if dev data directories exist and handle per user choice; abort if declined
    section_check_dev_data_dirs || exit 1

    show_message "ask_init_database"
    ask "(y/n)" "y"
    if [[ "$ask_result" == "y" ]]; then
        section_init_database_dev || true
    else
        show_message "tips_init_database_failed"
    fi

    section_display_dev_report
    exit 0
fi

section_download_files(){
    # Download files asynchronously
    if ! command -v wget &> /dev/null ; then
        echo "wget" $(show_message "tips_no_executable")
        exit 1
    fi

    download_file "$SOURCE_URL/${FILES[0]}" "docker-compose.yml"
    download_file "$SOURCE_URL/${FILES[1]}" "init_data.json"
    download_file "$SOURCE_URL/${FILES[2]}" "searxng-settings.yml"

    # Download .env.example with the specified language
    if [ "$LANGUAGE" = "zh_CN" ]; then
        download_file "$SOURCE_URL/${ENV_EXAMPLES[0]}" ".env"
    else
        download_file "$SOURCE_URL/${ENV_EXAMPLES[1]}" ".env"
    fi
}
# If the folder `data` or `s3_data` exists, warn the user
if [ -d "data" ] || [ -d "s3_data" ]; then
    show_message "tips_already_installed"
    exit 0
else
    section_download_files
fi

section_configurate_host() {
    DEPLOY_MODE=$ask_result
    show_message "host_regenerate"
    # If run in local mode, skip this step
    if [[ "$DEPLOY_MODE" == "2" ]]; then
        HOST="localhost:3210"
        LOBE_HOST="$HOST"
        return 0
    fi

    # Configurate protocol for domain
    if [[ "$DEPLOY_MODE" == "0" ]]; then
        # Ask if enable https
        echo $(show_message "ask_protocol")
        ask "(y/n)" "y"
        if [[ "$ask_result" == "y" ]]; then
            PROTOCOL="https"
            # Replace all http with https
            sed "${SED_INPLACE_ARGS[@]}" "s#http://#https://#" .env
        fi
    fi

    # Check if sed is installed
    if ! command -v sed "${SED_INPLACE_ARGS[@]}" &> /dev/null ; then
        echo "sed" $(show_message "tips_no_executable")
        exit 1
    fi

    # If user not specify host, try to get the server ip
    if [ -z "$HOST" ]; then
        HOST=$(hostname -I | awk '{print $1}')
        # If the host is a private ip and the deploy mode is port mode
        if [[ "$DEPLOY_MODE" == "1" ]] && ([[ "$HOST" == "192.168."* ]] || [[ "$HOST" == "172."* ]] || [[ "$HOST" == "10."* ]]); then
            echo $(show_message "tips_private_ip_detected")
        fi
    fi


    case $DEPLOY_MODE in
        0)
            DEPLOY_MODE="domain"
            echo "LobeChat" $(show_message "ask_domain" "example.com")
            ask "(example.com)"
            LOBE_HOST="$ask_result"
            # If user use domain mode, ask for the domain of Minio and Casdoor
            echo "Minio S3 API" $(show_message "ask_domain" "minio.example.com")
            ask "(minio.example.com)"
            MINIO_HOST="$ask_result"
            echo "Casdoor API" $(show_message "ask_domain" "auth.example.com")
            ask "(auth.example.com)"
            CASDOOR_HOST="$ask_result"
            # Setup callback url for Casdoor
            sed "${SED_INPLACE_ARGS[@]}" "s/"example.com"/${LOBE_HOST}/" init_data.json
        ;;
        1)
            DEPLOY_MODE="ip"
            ask $(printf "%s%s" "LobeChat" $(show_message "ask_host")) "$HOST" $(printf "%s" $(show_message "tips_auto_detected"))
            LOBE_HOST="$ask_result"
            # If user use ip mode, use ask_result as the host
            HOST="$ask_result"
            # If user use ip mode, append the port to the host
            LOBE_HOST="${HOST}:3210"
            MINIO_HOST="${HOST}:9000"
            CASDOOR_HOST="${HOST}:8000"
            # Setup callback url for Casdoor
            sed "${SED_INPLACE_ARGS[@]}" "s/"localhost:3210"/${LOBE_HOST}/" init_data.json
        ;;
        *)
            echo "Invalid deploy mode: $ask_result"
            exit 1
        ;;
    esac

    # lobe host
    sed "${SED_INPLACE_ARGS[@]}" "s#^APP_URL=.*#APP_URL=$PROTOCOL://$LOBE_HOST#" .env
    # auth related
    sed "${SED_INPLACE_ARGS[@]}" "s#^AUTH_URL=.*#AUTH_URL=$PROTOCOL://$LOBE_HOST/api/auth#" .env
    sed "${SED_INPLACE_ARGS[@]}" "s#^AUTH_CASDOOR_ISSUER=.*#AUTH_CASDOOR_ISSUER=$PROTOCOL://$CASDOOR_HOST#" .env
    sed "${SED_INPLACE_ARGS[@]}" "s#^origin=.*#origin=$PROTOCOL://$CASDOOR_HOST#" .env
    # s3 related
    sed "${SED_INPLACE_ARGS[@]}" "s#^S3_PUBLIC_DOMAIN=.*#S3_PUBLIC_DOMAIN=$PROTOCOL://$MINIO_HOST#" .env
    sed "${SED_INPLACE_ARGS[@]}" "s#^S3_ENDPOINT=.*#S3_ENDPOINT=$PROTOCOL://$MINIO_HOST#" .env


    # Check if env modified success
    if [ $? -ne 0 ]; then
        echo $(show_message "host_regenerate_failed") "$HOST in \`.env\`"
    fi
}

if [ -z "$ask_result" ]; then
    show_message "ask_deploy_mode"
    ask "(0,1,2)" "2"
fi
if [[ "$ask_result" == "0" ]] || [[ "$ask_result" == "1" ]] || [[ "$ask_result" == "2" ]]; then
    section_configurate_host
else
    echo "Invalid deploy mode: $ask_result, please select 0, 1 or 2."
    exit 1
fi

# ==========================
# === Regenerate Secrets ===
# ==========================
section_regenerate_secrets() {
    # Check if openssl is installed
    if ! command -v openssl &> /dev/null ; then
        echo "openssl" $(show_message "tips_no_executable")
        exit 1
    fi
    if ! command -v tr &> /dev/null ; then
        echo "tr" $(show_message "tips_no_executable")
        exit 1
    fi
    if ! command -v fold &> /dev/null ; then
        echo "fold" $(show_message "tips_no_executable")
        exit 1
    fi
    if ! command -v head &> /dev/null ; then
        echo "head" $(show_message "tips_no_executable")
        exit 1
    fi

    generate_key() {
        if [[ -z "$1" ]]; then
            echo "Usage: generate_key <length>"
            return 1
        fi
        echo $(openssl rand -hex $1 | tr -d '\n' | fold -w $1 | head -n 1)
    }

    if ! command -v sed &> /dev/null ; then
        echo "sed" $(show_message "tips_no_executable")
        exit 1
    fi
    echo $(show_message "security_secrect_regenerate")

    # Generate CASDOOR_SECRET
    CASDOOR_SECRET=$(generate_key 32)
    if [ $? -ne 0 ]; then
        echo $(show_message "security_secrect_regenerate_failed") "CASDOOR_SECRET"
    else
        # Search and replace the value of CASDOOR_SECRET in .env
        sed "${SED_INPLACE_ARGS[@]}" "s#^AUTH_CASDOOR_SECRET=.*#AUTH_CASDOOR_SECRET=${CASDOOR_SECRET}#" .env
        if [ $? -ne 0 ]; then
            echo $(show_message "security_secrect_regenerate_failed") "AUTH_CASDOOR_SECRET in \`.env\`"
        fi
        # replace `clientSecrect` in init_data.json
        sed "${SED_INPLACE_ARGS[@]}" "s#dbf205949d704de81b0b5b3603174e23fbecc354#${CASDOOR_SECRET}#" init_data.json
        if [ $? -ne 0 ]; then
            echo $(show_message "security_secrect_regenerate_failed") "AUTH_CASDOOR_SECRET in \`init_data.json\`"
        fi
    fi

    # Generate Casdoor User
    CASDOOR_USER="admin"
    CASDOOR_PASSWORD=$(generate_key 10)
    if [ $? -ne 0 ]; then
        echo $(show_message "security_secrect_regenerate_failed") "CASDOOR_PASSWORD"
        CASDOOR_PASSWORD="pswd123"
    else
        # replace `password` in init_data.json
        sed "${SED_INPLACE_ARGS[@]}" "s/"pswd123"/${CASDOOR_PASSWORD}/" init_data.json
        if [ $? -ne 0 ]; then
            echo $(show_message "security_secrect_regenerate_failed") "CASDOOR_PASSWORD in \`init_data.json\`"
        fi
    fi
    # Generate Minio S3 User Password
    MINIO_ROOT_PASSWORD=$(generate_key 8)
    if [ $? -ne 0 ]; then
        echo $(show_message "security_secrect_regenerate_failed") "MINIO_ROOT_PASSWORD"
        MINIO_ROOT_PASSWORD="YOUR_MINIO_PASSWORD"
    else
        # Search and replace the value of S3_SECRET_ACCESS_KEY in .env
        sed "${SED_INPLACE_ARGS[@]}" "s#^MINIO_ROOT_PASSWORD=.*#MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}#" .env
        if [ $? -ne 0 ]; then
            echo $(show_message "security_secrect_regenerate_failed") "MINIO_ROOT_PASSWORD in \`.env\`"
        fi
    fi
}

show_message "ask_regenerate_secrets"
ask "(y/n)" "y"
if [[ "$ask_result" == "y" ]]; then
    section_regenerate_secrets
fi

section_init_database() {
    if ! command -v docker &> /dev/null ; then
        echo "docker" $(show_message "tips_no_executable")
	    return 1
    fi

    if ! docker compose &> /dev/null ; then
	    echo "docker compose" $(show_message "tips_no_executable")
	    return 1
    fi

    # Check if user has permissions to run Docker by trying to get the status of Docker (docker status).
    # If this fails, the user probably does not have permissions for Docker.
    # ref: https://github.com/paperless-ngx/paperless-ngx/blob/89e5c08a1fe4ca0b7641ae8fbd5554502199ae40/install-paperless-ngx.sh#L64-L72
    if ! docker stats --no-stream &> /dev/null ; then
	    echo $(show_message "tips_no_docker_permission")
	    return 1
    fi

    docker compose pull
    docker compose up --detach postgresql casdoor
    # hopefully enough time for even the slower systems
	sleep 15
	docker compose stop

    # Init finished, remove init mount
    echo '{}' > init_data.json
}

show_message "ask_init_database"
ask "(y/n)" "y"
if [[ "$ask_result" == "y" ]]; then
    # If return 1 means failed
    section_init_database
    if [ $? -ne 0 ]; then
        echo $(show_message "tips_init_database_failed")
    fi
else
    show_message "tips_init_database_failed"
fi

section_display_configurated_report() {
    # Display configuration reports
    echo $(show_message "security_secrect_regenerate_report")

    echo -e "LobeChat: \n  - URL: $PROTOCOL://$LOBE_HOST \n  - Username: user \n  - Password: ${CASDOOR_PASSWORD} "
    echo -e "Casdoor: \n  - URL: $PROTOCOL://$CASDOOR_HOST \n  - Username: admin \n  - Password: ${CASDOOR_PASSWORD}\n"
    echo -e "Minio: \n  - URL: $PROTOCOL://$MINIO_HOST \n  - Username: admin\n  - Password: ${MINIO_ROOT_PASSWORD}\n"

    # if user run in domain mode, diplay reverse proxy configuration
    if [[ "$DEPLOY_MODE" == "domain" ]]; then
        echo $(show_message "tips_add_reverse_proxy")
        printf "\n%s\t->\t%s\n" "$LOBE_HOST" "127.0.0.1:3210"
        printf "%s\t->\t%s\n" "$CASDOOR_HOST" "127.0.0.1:8000"
        printf "%s\t->\t%s\n" "$MINIO_HOST" "127.0.0.1:9000"
    fi

    # Display final message

    printf "\n%s\n\n" "$(show_message "tips_run_command")"
    print_centered "docker compose up -d" "green"
    printf "\n%s\n" "$(show_message "tips_allow_ports")"
    printf "\n%s" "$(show_message "tips_show_documentation")"
    printf "%s\n" $(show_message "tips_show_documentation_url")
}
section_display_configurated_report

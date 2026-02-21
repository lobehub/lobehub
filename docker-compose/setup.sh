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
                    echo "检测到您已经运行过 LobeHub，本安装程序只能完成初始化配置，并不能重复安装。如果你需要重新安装，请删除 data 和 s3_data 文件夹。"
                ;;
                *)
                    echo "It is detected that you have run LobeHub. This installation program can only complete the initialization configuration and cannot be reinstalled. If you need to reinstall, please delete the data and s3_data folders."
                ;;
            esac
        ;;
        tips_run_command)
            case $LANGUAGE in
                zh_CN)
                    echo "您已经完成了所有配置。请运行以下命令启动 LobeHub 尝试启动："
                ;;
                *)
                    echo "You have completed all configurations. Please run this command to start LobeHub:"
                ;;
            esac
        ;;
        tips_if_want_searxng_logs)
            case $LANGUAGE in
                zh_CN)
                    echo "在上述命令中已屏蔽 SearXNG 的日志。如果你想查看 SearXNG 的日志，可以去除选项： --no-attach searxng 或运行以下命令："
                ;;
                *)
                    echo "In the above command, the logs of SearXNG are blocked by default. If you want to view the logs of SearXNG, you can remove the option: --no-attach searxng or run the following command:"
                ;;
            esac
        ;;
        tips_if_run_normally)
            case $LANGUAGE in
                zh_CN)
                    echo "如果一切运行正常，你可以使用以下指令在 daemon 模式下启动 LobeHub:"
                ;;
                *)
                    echo "If everything runs normally, you can use the following command to start LobeHub in daemon mode:"
                ;;
            esac
        ;;
        tips_regen_jwks)
            case $LANGUAGE in
                zh_CN)
                    echo "在完成部署测试后，请前往 https://lobehub.com/zh/docs/self-hosting/environment-variables/auth#jwks_key 生成新的 JWKS_KEY 并替换 .env 中的值，以确保安全性。"
                ;;
                *)
                    echo "After completing the deployment test, please go to https://lobehub.com/docs/self-hosting/environment-variables/auth#jwks_key to generate a new JWKS_KEY and replace the value in .env to ensure security."
                ;;
            esac
        ;;
        tips_disable_registration)
            case $LANGUAGE in
                zh_CN)
                    echo "如需限制用户注册，可在 .env 中配置："
                    echo "  - 使用 SSO 登录时，设置 AUTH_DISABLE_EMAIL_PASSWORD=1 可禁用邮箱密码注册"
                    echo "  - 使用邮箱密码登录时，设置 AUTH_ALLOWED_EMAILS=user1@example.com,user2@example.com 可限制允许登录的邮箱"
                ;;
                *)
                    echo "To restrict user registration, configure in .env:"
                    echo "  - For SSO login: set AUTH_DISABLE_EMAIL_PASSWORD=1 to disable email/password registration"
                    echo "  - For email/password login: set AUTH_ALLOWED_EMAILS=user1@example.com,user2@example.com to allow specific emails"
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
                    echo "请确保服务器以下端口未被占用且能被访问：3210, 9000, 9001"
                ;;
                *)
                    echo "Please make sure the following ports on the server are not occupied and can be accessed: 3210, 9000, 9001"
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
                    echo "无法初始化数据库"
                ;;
                *)
                    echo "Failed to initialize the database."
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
                    echo "(0) 域名模式（访问时无需指明端口），需要使用反向代理服务 LobeHub, RustFS，并分别分配一个域名；"
                    echo "(1) 端口模式（访问时需要指明端口，如使用IP访问，或域名+端口访问），需要放开指定端口；"
                    echo "(2) 本地模式（仅供本地测试使用）"
                    echo "如果你对这些内容疑惑，可以先选择使用本地模式进行部署，稍后根据文档指引再进行修改。"
                    echo "https://lobehub.com/docs/self-hosting/server-database/docker-compose"
                ;;
                *)
                    echo "Please select the deployment mode:"
                    echo "(0) Domain mode (no need to specify the port when accessing), you need to use the reverse proxy service LobeHub, RustFS, and assign a domain name respectively;"
                    echo "(1) Port mode (need to specify the port when accessing, such as using IP access, or domain name + port access), you need to open the specified port;"
                    echo "(2) Local mode (for local testing only)"
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
    wget "$1" -O "$2"
    # If run failed, exit
    if [ $? -ne 0 ]; then
        show_message "tips_download_failed" "$2"
        exit 1
    fi
}

print_centered() {
    local text="$1"                                   # Get input texts
    local color="${2:-reset}"                         # Get color, default to reset
    local term_width=$(tput cols)                     # Get terminal width
    local text_length=${#text}                        # Get text length
    local padding=$(((term_width - text_length) / 2)) # Get padding

    # Get color code (compatible with bash 3.x)
    local color_code=""
    local reset_code="\e[0m"
    case "$color" in
        black)   color_code="\e[30m" ;;
        red)     color_code="\e[31m" ;;
        green)   color_code="\e[32m" ;;
        yellow)  color_code="\e[33m" ;;
        blue)    color_code="\e[34m" ;;
        magenta) color_code="\e[35m" ;;
        cyan)    color_code="\e[36m" ;;
        white)   color_code="\e[37m" ;;
        reset)   color_code="\e[0m" ;;
        *)
            echo "Invalid color specified. Available colors: black red green yellow blue magenta cyan white reset"
            return 1
        ;;
    esac

    # Print the text with padding
    printf "%*s${color_code}%s${reset_code}\n" $padding "" "$text"
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
SUB_DIR="docker-compose/deploy"
FILES=(
    "$SUB_DIR/docker-compose.yml"
    "$SUB_DIR/searxng-settings.yml"
    "$SUB_DIR/bucket.config.json"
)
ENV_EXAMPLES=(
    "$SUB_DIR/.env.zh-CN.example"
    "$SUB_DIR/.env.example"
)
# Default values
RUSTFS_SECRET_KEY="YOUR_RUSTFS_PASSWORD"
RUSTFS_HOST="localhost:9000"
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

section_download_files(){
    # Download files asynchronously
    if ! command -v wget &> /dev/null ; then
        echo "wget" $(show_message "tips_no_executable")
        exit 1
    fi
    
    download_file "$SOURCE_URL/${FILES[0]}" "docker-compose.yml"
    download_file "$SOURCE_URL/${FILES[1]}" "searxng-settings.yml"
    download_file "$SOURCE_URL/${FILES[2]}" "bucket.config.json"
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
            echo "LobeHub" $(show_message "ask_domain" "example.com")
            ask "(example.com)"
            LOBE_HOST="$ask_result"
            # If user use domain mode, ask for the domain of RustFS
            echo "RustFS S3 API" $(show_message "ask_domain" "s3.example.com")
            ask "(s3.example.com)"
            RUSTFS_HOST="$ask_result"
        ;;
        1)
            DEPLOY_MODE="ip"
            ask $(printf "%s%s" "LobeHub" $(show_message "ask_host")) "$HOST" $(printf "%s" $(show_message "tips_auto_detected"))
            LOBE_HOST="$ask_result"
            # If user use ip mode, use ask_result as the host
            HOST="$ask_result"
            # If user use ip mode, append the port to the host
            LOBE_HOST="${HOST}:3210"
            RUSTFS_HOST="${HOST}:9000"
        ;;
        *)
            echo "Invalid deploy mode: $ask_result"
            exit 1
        ;;
    esac

    # lobe host
    sed "${SED_INPLACE_ARGS[@]}" "s#^APP_URL=.*#APP_URL=$PROTOCOL://$LOBE_HOST#" .env
    # s3 related
    sed "${SED_INPLACE_ARGS[@]}" "s#^S3_ENDPOINT=.*#S3_ENDPOINT=$PROTOCOL://$RUSTFS_HOST#" .env
    

    # Check if env modified success
    if [ $? -ne 0 ]; then
        echo $(show_message "host_regenerate_failed") "$HOST in \`.env\`"
    fi
}
show_message "ask_deploy_mode"
ask "(0,1,2)" "2"
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

    # Generate RUSTFS S3 User Password
    RUSTFS_SECRET_KEY=$(generate_key 8)
    if [ $? -ne 0 ]; then
        echo $(show_message "security_secrect_regenerate_failed") "RUSTFS_SECRET_KEY"
        RUSTFS_SECRET_KEY="YOUR_RUSTFS_PASSWORD"
    else
        sed "${SED_INPLACE_ARGS[@]}" "s#^RUSTFS_SECRET_KEY=.*#RUSTFS_SECRET_KEY=${RUSTFS_SECRET_KEY}#" .env
        if [ $? -ne 0 ]; then
            echo $(show_message "security_secrect_regenerate_failed") "RUSTFS_SECRET_KEY in \`.env\`"
        fi
    fi

    # Generate KEY_VAULTS_SECRET (base64 encoded 32 bytes)
    KEY_VAULTS_SECRET=$(openssl rand -base64 32)
    if [ $? -ne 0 ]; then
        echo $(show_message "security_secrect_regenerate_failed") "KEY_VAULTS_SECRET"
    else
        sed "${SED_INPLACE_ARGS[@]}" "s#^KEY_VAULTS_SECRET=.*#KEY_VAULTS_SECRET=${KEY_VAULTS_SECRET}#" .env
        if [ $? -ne 0 ]; then
            echo $(show_message "security_secrect_regenerate_failed") "KEY_VAULTS_SECRET in \`.env\`"
        fi
    fi

    # Generate AUTH_SECRET (base64 encoded 32 bytes)
    AUTH_SECRET=$(openssl rand -base64 32)
    if [ $? -ne 0 ]; then
        echo $(show_message "security_secrect_regenerate_failed") "AUTH_SECRET"
    else
        sed "${SED_INPLACE_ARGS[@]}" "s#^AUTH_SECRET=.*#AUTH_SECRET=${AUTH_SECRET}#" .env
        if [ $? -ne 0 ]; then
            echo $(show_message "security_secrect_regenerate_failed") "AUTH_SECRET in \`.env\`"
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
    docker compose up --detach postgresql
    # hopefully enough time for even the slower systems
	sleep 15
	docker compose stop
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

    echo -e "LobeHub: \n  - URL: $PROTOCOL://$LOBE_HOST"
    echo -e "RustFS: \n  - URL: $PROTOCOL://$RUSTFS_HOST \n  - Username: admin\n  - Password: ${RUSTFS_SECRET_KEY}\n"

    # if user run in domain mode, diplay reverse proxy configuration
    if [[ "$DEPLOY_MODE" == "domain" ]]; then
        echo $(show_message "tips_add_reverse_proxy")
        printf "\n%s\t->\t%s\n" "$LOBE_HOST" "127.0.0.1:3210"
        printf "%s\t->\t%s\n" "$RUSTFS_HOST" "127.0.0.1:9000"
    fi

    # Display final message

    printf "\n%s\n\n" "$(show_message "tips_run_command")"
    print_centered "docker compose up --no-attach searxng" "green"
    printf "\n%s\n" "$(show_message "tips_if_run_normally")"
    printf "\n%s\n" "$(show_message "tips_regen_jwks")"
    printf "\n%s\n\n" "$(show_message "tips_disable_registration")"
    print_centered "docker compose up -d --no-attach searxng" "green"
    printf "\n%s\n" "$(show_message "tips_if_want_searxng_logs")"
    print_centered "docker compose logs -f searxng" "white"
    printf "\n%s\n" "$(show_message "tips_allow_ports")"
    printf "\n%s" "$(show_message "tips_show_documentation")"
    printf "%s\n" $(show_message "tips_show_documentation_url")
}
section_display_configurated_report

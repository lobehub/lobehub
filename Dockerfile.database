## Set global build ENV
ARG NODEJS_VERSION="24"

## Base image for all building stages
FROM node:${NODEJS_VERSION}-slim AS base

ARG USE_CN_MIRROR

ENV DEBIAN_FRONTEND="noninteractive"

RUN \
    # If you want to build docker in China, build with --build-arg USE_CN_MIRROR=true
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        sed -i "s/deb.debian.org/mirrors.ustc.edu.cn/g" "/etc/apt/sources.list.d/debian.sources"; \
    fi \
    # Add required package
    && apt update \
    && apt install ca-certificates proxychains-ng -qy \
    # Prepare required package to distroless
    && mkdir -p /distroless/bin /distroless/etc /distroless/etc/ssl/certs /distroless/lib \
    # Copy proxychains to distroless
    && cp /usr/lib/$(arch)-linux-gnu/libproxychains.so.4 /distroless/lib/libproxychains.so.4 \
    && cp /usr/lib/$(arch)-linux-gnu/libdl.so.2 /distroless/lib/libdl.so.2 \
    && cp /usr/bin/proxychains4 /distroless/bin/proxychains \
    && cp /etc/proxychains4.conf /distroless/etc/proxychains4.conf \
    # Copy node to distroless
    && cp /usr/lib/$(arch)-linux-gnu/libstdc++.so.6 /distroless/lib/libstdc++.so.6 \
    && cp /usr/lib/$(arch)-linux-gnu/libgcc_s.so.1 /distroless/lib/libgcc_s.so.1 \
    && cp /usr/local/bin/node /distroless/bin/node \
    # Copy CA certificates to distroless
    && cp /etc/ssl/certs/ca-certificates.crt /distroless/etc/ssl/certs/ca-certificates.crt \
    # Cleanup temp files
    && rm -rf /tmp/* /var/lib/apt/lists/* /var/tmp/*

## Builder image, install all the dependencies and build the app
FROM base AS builder

ARG USE_CN_MIRROR
ARG NEXT_PUBLIC_BASE_PATH
ARG NEXT_PUBLIC_SERVICE_MODE
ARG NEXT_PUBLIC_ENABLE_NEXT_AUTH
ARG NEXT_PUBLIC_ENABLE_CLERK_AUTH
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_ANALYTICS_POSTHOG
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_ANALYTICS_UMAMI
ARG NEXT_PUBLIC_UMAMI_SCRIPT_URL
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
ARG FEATURE_FLAGS

ENV NEXT_PUBLIC_BASE_PATH="${NEXT_PUBLIC_BASE_PATH}" \
    FEATURE_FLAGS="${FEATURE_FLAGS}"

ENV NEXT_PUBLIC_SERVICE_MODE="${NEXT_PUBLIC_SERVICE_MODE:-server}" \
    NEXT_PUBLIC_ENABLE_NEXT_AUTH="${NEXT_PUBLIC_ENABLE_NEXT_AUTH:-1}" \
    NEXT_PUBLIC_ENABLE_CLERK_AUTH="${NEXT_PUBLIC_ENABLE_CLERK_AUTH:-0}" \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
    CLERK_WEBHOOK_SECRET="whsec_xxx" \
    APP_URL="http://app.com" \
    DATABASE_DRIVER="node" \
    DATABASE_URL="postgres://postgres:password@localhost:5432/postgres" \
    KEY_VAULTS_SECRET="use-for-build"

# Sentry
ENV NEXT_PUBLIC_SENTRY_DSN="${NEXT_PUBLIC_SENTRY_DSN}" \
    SENTRY_ORG="" \
    SENTRY_PROJECT=""

# Posthog
ENV NEXT_PUBLIC_ANALYTICS_POSTHOG="${NEXT_PUBLIC_ANALYTICS_POSTHOG}" \
    NEXT_PUBLIC_POSTHOG_HOST="${NEXT_PUBLIC_POSTHOG_HOST}" \
    NEXT_PUBLIC_POSTHOG_KEY="${NEXT_PUBLIC_POSTHOG_KEY}"

# Umami
ENV NEXT_PUBLIC_ANALYTICS_UMAMI="${NEXT_PUBLIC_ANALYTICS_UMAMI}" \
    NEXT_PUBLIC_UMAMI_SCRIPT_URL="${NEXT_PUBLIC_UMAMI_SCRIPT_URL}" \
    NEXT_PUBLIC_UMAMI_WEBSITE_ID="${NEXT_PUBLIC_UMAMI_WEBSITE_ID}"

# Node
ENV NODE_OPTIONS="--max-old-space-size=6144"

WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY packages ./packages

RUN \
    # If you want to build docker in China, build with --build-arg USE_CN_MIRROR=true
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        export SENTRYCLI_CDNURL="https://npmmirror.com/mirrors/sentry-cli"; \
        npm config set registry "https://registry.npmmirror.com/"; \
        echo 'canvas_binary_host_mirror=https://npmmirror.com/mirrors/canvas' >> .npmrc; \
    fi \
    # Set the registry for corepack
    && export COREPACK_NPM_REGISTRY=$(npm config get registry | sed 's/\/$//') \
    # Update corepack to latest (nodejs/corepack#612)
    && npm i -g corepack@latest \
    # Enable corepack
    && corepack enable \
    # Use pnpm for corepack
    && corepack use $(sed -n 's/.*"packageManager": "\(.*\)".*/\1/p' package.json) \
    # Install the dependencies
    && pnpm i \
    # Add db migration dependencies
    && mkdir -p /deps \
    && cd /deps \
    && pnpm init \
    && pnpm add pg drizzle-orm

COPY . .

# run build standalone for docker version
RUN npm run build:docker

## Application image, copy all the files for production
FROM busybox:latest AS app

COPY --from=base /distroless/ /

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder /app/.next/standalone /app/

# Copy database migrations
COPY --from=builder /app/packages/database/migrations /app/migrations
COPY --from=builder /app/scripts/migrateServerDB/docker.cjs /app/docker.cjs
COPY --from=builder /app/scripts/migrateServerDB/errorHint.js /app/errorHint.js

# copy dependencies
COPY --from=builder /deps/node_modules/.pnpm /app/node_modules/.pnpm
COPY --from=builder /deps/node_modules/pg /app/node_modules/pg
COPY --from=builder /deps/node_modules/drizzle-orm /app/node_modules/drizzle-orm

# Copy server launcher
COPY --from=builder /app/scripts/serverLauncher/startServer.js /app/startServer.js

RUN \
    # Add nextjs:nodejs to run the app
    addgroup -S -g 1001 nodejs \
    && adduser -D -G nodejs -H -S -h /app -u 1001 nextjs \
    # Set permission for nextjs:nodejs
    && chown -R nextjs:nodejs /app /etc/proxychains4.conf

## Production image, copy all the files and run next
FROM scratch

# Copy all the files from app, set the correct permission for prerender cache
COPY --from=app / /

ENV NODE_ENV="production" \
    NODE_OPTIONS="--dns-result-order=ipv4first --use-openssl-ca" \
    NODE_EXTRA_CA_CERTS="" \
    NODE_TLS_REJECT_UNAUTHORIZED="" \
    SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"

# Make the middleware rewrite through local as default
# refs: https://github.com/lobehub/lobe-chat/issues/5876
ENV MIDDLEWARE_REWRITE_THROUGH_LOCAL="1"

# set hostname to localhost
ENV HOSTNAME="0.0.0.0" \
    PORT="3210"

# General Variables
ENV ACCESS_CODE="" \
    APP_URL="" \
    API_KEY_SELECT_MODE="" \
    DEFAULT_AGENT_CONFIG="" \
    SYSTEM_AGENT="" \
    FEATURE_FLAGS="" \
    PROXY_URL="" \
    ENABLE_AUTH_PROTECTION=""

# Database
ENV KEY_VAULTS_SECRET="" \
    DATABASE_DRIVER="node" \
    DATABASE_URL=""

# Next Auth
ENV NEXT_AUTH_SECRET="" \
    NEXT_AUTH_SSO_PROVIDERS="" \
    NEXTAUTH_URL=""

# Clerk
ENV CLERK_SECRET_KEY="" \
    CLERK_WEBHOOK_SECRET=""

# S3
ENV NEXT_PUBLIC_S3_DOMAIN="" \
    S3_PUBLIC_DOMAIN="" \
    S3_ACCESS_KEY_ID="" \
    S3_BUCKET="" \
    S3_ENDPOINT="" \
    S3_SECRET_ACCESS_KEY="" \
    S3_ENABLE_PATH_STYLE="" \
    S3_SET_ACL=""

# Model Variables
ENV \
    # AI21
    AI21_API_KEY="" AI21_MODEL_LIST="" \
    # Ai360
    AI360_API_KEY="" AI360_MODEL_LIST="" \
    # AiHubMix
    AIHUBMIX_API_KEY="" AIHUBMIX_MODEL_LIST="" \
    # Anthropic
    ANTHROPIC_API_KEY="" ANTHROPIC_MODEL_LIST="" ANTHROPIC_PROXY_URL="" \
    # Amazon Bedrock
    ENABLED_AWS_BEDROCK="" AWS_ACCESS_KEY_ID="" AWS_SECRET_ACCESS_KEY="" AWS_REGION="" AWS_BEDROCK_MODEL_LIST="" \
    # Azure OpenAI
    AZURE_API_KEY="" AZURE_API_VERSION="" AZURE_ENDPOINT="" AZURE_MODEL_LIST="" \
    # Baichuan
    BAICHUAN_API_KEY="" BAICHUAN_MODEL_LIST="" \
    # Cloudflare
    CLOUDFLARE_API_KEY="" CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID="" CLOUDFLARE_MODEL_LIST="" \
    # Cohere
    COHERE_API_KEY="" COHERE_MODEL_LIST="" COHERE_PROXY_URL="" \
    # ComfyUI
    ENABLED_COMFYUI="" COMFYUI_BASE_URL="" COMFYUI_AUTH_TYPE="" \
    COMFYUI_API_KEY="" COMFYUI_USERNAME="" COMFYUI_PASSWORD="" COMFYUI_CUSTOM_HEADERS="" \
    # DeepSeek
    DEEPSEEK_API_KEY="" DEEPSEEK_MODEL_LIST="" \
    # Fireworks AI
    FIREWORKSAI_API_KEY="" FIREWORKSAI_MODEL_LIST="" \
    # Gitee AI
    GITEE_AI_API_KEY="" GITEE_AI_MODEL_LIST="" \
    # GitHub
    GITHUB_TOKEN="" GITHUB_MODEL_LIST="" \
    # Google
    GOOGLE_API_KEY="" GOOGLE_MODEL_LIST="" GOOGLE_PROXY_URL="" \
    # Groq
    GROQ_API_KEY="" GROQ_MODEL_LIST="" GROQ_PROXY_URL="" \
    # Higress
    HIGRESS_API_KEY="" HIGRESS_MODEL_LIST="" HIGRESS_PROXY_URL="" \
    # HuggingFace
    HUGGINGFACE_API_KEY="" HUGGINGFACE_MODEL_LIST="" HUGGINGFACE_PROXY_URL="" \
    # Hunyuan
    HUNYUAN_API_KEY="" HUNYUAN_MODEL_LIST="" \
    # InternLM
    INTERNLM_API_KEY="" INTERNLM_MODEL_LIST="" \
    # Jina
    JINA_API_KEY="" JINA_MODEL_LIST="" JINA_PROXY_URL="" \
    # Minimax
    MINIMAX_API_KEY="" MINIMAX_MODEL_LIST="" \
    # Mistral
    MISTRAL_API_KEY="" MISTRAL_MODEL_LIST="" \
    # ModelScope
    MODELSCOPE_API_KEY="" MODELSCOPE_MODEL_LIST="" MODELSCOPE_PROXY_URL="" \
    # Moonshot
    MOONSHOT_API_KEY="" MOONSHOT_MODEL_LIST="" MOONSHOT_PROXY_URL="" \
    # Nebius
    NEBIUS_API_KEY="" NEBIUS_MODEL_LIST="" NEBIUS_PROXY_URL="" \
    # NewAPI
    NEWAPI_API_KEY="" NEWAPI_PROXY_URL="" \
    # Novita
    NOVITA_API_KEY="" NOVITA_MODEL_LIST="" \
    # Nvidia NIM
    NVIDIA_API_KEY="" NVIDIA_MODEL_LIST="" NVIDIA_PROXY_URL="" \
    # Ollama
    ENABLED_OLLAMA="" OLLAMA_MODEL_LIST="" OLLAMA_PROXY_URL="" \
    # OpenAI
    ENABLED_OPENAI="" OPENAI_API_KEY="" OPENAI_MODEL_LIST="" OPENAI_PROXY_URL="" \
    # OpenRouter
    OPENROUTER_API_KEY="" OPENROUTER_MODEL_LIST="" \
    # Perplexity
    PERPLEXITY_API_KEY="" PERPLEXITY_MODEL_LIST="" PERPLEXITY_PROXY_URL="" \
    # PPIO
    PPIO_API_KEY="" PPIO_MODEL_LIST="" \
    # Qiniu
    QINIU_API_KEY="" QINIU_MODEL_LIST="" QINIU_PROXY_URL="" \
    # Qwen
    QWEN_API_KEY="" QWEN_MODEL_LIST="" QWEN_PROXY_URL="" \
    # SambaNova
    SAMBANOVA_API_KEY="" SAMBANOVA_MODEL_LIST="" \
    # Search1API
    SEARCH1API_API_KEY="" SEARCH1API_MODEL_LIST="" \
    # SenseNova
    SENSENOVA_API_KEY="" SENSENOVA_MODEL_LIST="" \
    # SiliconCloud
    SILICONCLOUD_API_KEY="" SILICONCLOUD_MODEL_LIST="" SILICONCLOUD_PROXY_URL="" \
    # Spark
    SPARK_API_KEY="" SPARK_MODEL_LIST="" SPARK_PROXY_URL="" SPARK_SEARCH_MODE="" \
    # Stepfun
    STEPFUN_API_KEY="" STEPFUN_MODEL_LIST="" \
    # Taichu
    TAICHU_API_KEY="" TAICHU_MODEL_LIST="" \
    # TogetherAI
    TOGETHERAI_API_KEY="" TOGETHERAI_MODEL_LIST="" \
    # Upstage
    UPSTAGE_API_KEY="" UPSTAGE_MODEL_LIST="" \
    # v0 (Vercel)
    V0_API_KEY="" V0_MODEL_LIST="" \
    # vLLM
    VLLM_API_KEY="" VLLM_MODEL_LIST="" VLLM_PROXY_URL="" \
    # Wenxin
    WENXIN_API_KEY="" WENXIN_MODEL_LIST="" \
    # xAI
    XAI_API_KEY="" XAI_MODEL_LIST="" XAI_PROXY_URL="" \
    # Xinference
    XINFERENCE_API_KEY="" XINFERENCE_MODEL_LIST="" XINFERENCE_PROXY_URL="" \
    # 01.AI
    ZEROONE_API_KEY="" ZEROONE_MODEL_LIST="" \
    # Zhipu
    ZHIPU_API_KEY="" ZHIPU_MODEL_LIST="" \
    # Tencent Cloud
    TENCENT_CLOUD_API_KEY="" TENCENT_CLOUD_MODEL_LIST="" \
    # Infini-AI
    INFINIAI_API_KEY="" INFINIAI_MODEL_LIST="" \
    # 302.AI
    AI302_API_KEY="" AI302_MODEL_LIST="" \
    # FAL
    ENABLED_FAL="" FAL_API_KEY="" FAL_MODEL_LIST="" \
    # BFL
    BFL_API_KEY="" BFL_MODEL_LIST="" \
    # Vercel AI Gateway
    VERCELAIGATEWAY_API_KEY="" VERCELAIGATEWAY_MODEL_LIST="" \
    # Cerebras
    CEREBRAS_API_KEY="" CEREBRAS_MODEL_LIST=""

USER nextjs

EXPOSE 3210/tcp

ENTRYPOINT ["/bin/node"]

CMD ["/app/startServer.js"]

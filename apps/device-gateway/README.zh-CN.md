# Device Gateway

设备网关服务，用于本地开发与调试。

## Gateway 启动

```bash
pnpm --ignore-workspace install
cat > .dev.vars << EOF
JWKS_PUBLIC_KEY='$(node --env-file=../../.env scripts/extract-public-key.mjs)'
SERVICE_TOKEN='dev-service-token'
EOF
pnpm dev
```

## 服务端环境变量

主服务端通过以下环境变量连接 Device Gateway：

```bash
# Device Gateway 的 HTTP 基础地址，例如 https://device-gateway.example.com
# 在本地开发时，通常是 http://localhost:8787
DEVICE_GATEWAY_URL=http://localhost:8787
# 与 Device Gateway 中的 SERVICE_TOKEN 保持一致
DEVICE_GATEWAY_SERVICE_TOKEN=dev-service-token
```

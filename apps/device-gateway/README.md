# Device Gateway

**English** · [简体中文](./README.zh-CN.md)

Device Gateway is a local service for development and debugging.

## Gateway Startup

```bash
pnpm --ignore-workspace install
cat > .dev.vars << EOF
JWKS_PUBLIC_KEY='$(node --env-file=../../.env scripts/extract-public-key.mjs)'
SERVICE_TOKEN='dev-service-token'
EOF
pnpm dev
```

## Server Environment Variables

The main server connects to Device Gateway with the following environment variables:

```bash
# The base HTTP URL of Device Gateway, for example https://device-gateway.example.com
# In local development, this is usually http://localhost:8787
DEVICE_GATEWAY_URL=http://localhost:8787
# Must match SERVICE_TOKEN configured in Device Gateway
DEVICE_GATEWAY_SERVICE_TOKEN=dev-service-token
```

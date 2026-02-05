---
name: add-provider-doc
description: Guide for adding new AI provider documentation. Use when adding documentation for a new AI provider (like OpenAI, Anthropic, etc.), including usage docs, environment variables, Docker config, and image resources. Triggers on provider documentation tasks.
---

# Adding New AI Provider Documentation

Complete workflow for adding documentation for a new AI provider.

## Overview

1. Create usage documentation (EN + CN)
2. Add environment variable documentation (EN + CN)
3. Update Docker configuration files
4. Update .env.example
5. Prepare image resources

## Step 1: Create Provider Usage Documentation

### Required Files

- `docs/usage/providers/{provider-name}.mdx` (English)
- `docs/usage/providers/{provider-name}.zh-CN.mdx` (Chinese)

### Key Requirements

- 5-6 screenshots showing the process
- Cover image for the provider
- Real registration and dashboard URLs
- Pricing information callout
- **Never include real API keys** - use placeholders

Reference: `docs/usage/providers/fal.mdx`

## Step 2: Update Environment Variables Documentation

### Files to Update

- `docs/self-hosting/environment-variables/model-provider.mdx` (EN)
- `docs/self-hosting/environment-variables/model-provider.zh-CN.mdx` (CN)

### Content Format

```markdown
### `{PROVIDER}_API_KEY`

- Type: Required
- Description: API key from {Provider Name}
- Example: `{api-key-format}`

### `{PROVIDER}_MODEL_LIST`

- Type: Optional
- Description: Control model list. Use `+` to add, `-` to hide
- Example: `-all,+model-1,+model-2=Display Name`
```

## Step 3: Update Docker Files

Update all Dockerfiles at the **end** of ENV section:

- `Dockerfile`
- `Dockerfile.database`
- `Dockerfile.pglite`

```dockerfile
# {New Provider}
{PROVIDER}_API_KEY="" {PROVIDER}_MODEL_LIST=""
```

## Step 4: Update .env.example

```bash
### {Provider Name} ###
# {PROVIDER}_API_KEY={prefix}-xxxxxxxx
```

## Step 5: Image Resources

- Cover image
- 3-4 API dashboard screenshots
- 2-3 LobeChat configuration screenshots
- Host on LobeHub CDN: `hub-apac-1.lobeobjects.space`

## Checklist

- [ ] EN + CN usage docs
- [ ] EN + CN env var docs
- [ ] All 3 Dockerfiles updated
- [ ] .env.example updated
- [ ] All images prepared
- [ ] No real API keys in docs

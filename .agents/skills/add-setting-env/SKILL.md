---
name: add-setting-env
description: Guide for adding environment variables to configure user settings. Use when implementing server-side environment variables that control default values for user settings. Triggers on env var configuration or setting default value tasks.
---

# Adding Environment Variable for User Settings

Add server-side environment variables to configure default values for user settings.

**Priority**: User Custom > Server Env Var > Hardcoded Default

## Steps

### 1. Define Environment Variable

Create `src/envs/<domain>.ts`:

```typescript
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const get<Domain>Config = () => {
  return createEnv({
    server: {
      YOUR_ENV_VAR: z.coerce.number().min(MIN).max(MAX).optional(),
    },
    runtimeEnv: {
      YOUR_ENV_VAR: process.env.YOUR_ENV_VAR,
    },
  });
};

export const <domain>Env = get<Domain>Config();
```

### 2. Update Type (if new domain)

Add to `packages/types/src/serverConfig.ts`:

```typescript
import { User<Domain>Config } from './user/settings';

export interface GlobalServerConfig {
  <domain>?: PartialDeep<User<Domain>Config>;
}
```

**Prefer reusing existing types** from `packages/types/src/user/settings`.

### 3. Assemble Server Config (if new domain)

In `src/server/globalConfig/index.ts`:

```typescript
import { <domain>Env } from '@/envs/<domain>';

export const getServerGlobalConfig = async () => {
  const config: GlobalServerConfig = {
    <domain>: cleanObject({
      <settingName>: <domain>Env.YOUR_ENV_VAR,
    }),
  };
  return config;
};
```

### 4. Merge to User Store (if new domain)

In `src/store/user/slices/common/action.ts`:

```typescript
const serverSettings: PartialDeep<UserSettings> = {
  <domain>: serverConfig.<domain>,
};
```

### 5. Update .env.example

```bash
# <Description> (range/options, default: X)
# YOUR_ENV_VAR=<example>
```

### 6. Update Documentation

- `docs/self-hosting/environment-variables/basic.mdx` (EN)
- `docs/self-hosting/environment-variables/basic.zh-CN.mdx` (CN)

## Example: AI_IMAGE_DEFAULT_IMAGE_NUM

```typescript
// src/envs/image.ts
AI_IMAGE_DEFAULT_IMAGE_NUM: z.coerce.number().min(1).max(20).optional(),

// packages/types/src/serverConfig.ts
image?: PartialDeep<UserImageConfig>;

// src/server/globalConfig/index.ts
image: cleanObject({ defaultImageNum: imageEnv.AI_IMAGE_DEFAULT_IMAGE_NUM }),

// src/store/user/slices/common/action.ts
image: serverConfig.image,

// .env.example
# AI_IMAGE_DEFAULT_IMAGE_NUM=4
```

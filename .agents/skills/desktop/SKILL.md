---
name: desktop
description: Electron desktop development guide. Use when implementing desktop features, IPC handlers, controllers, preload scripts, window management, menu configuration, or Electron-specific functionality. Triggers on desktop app development, Electron IPC, or desktop local tools implementation.
disable-model-invocation: true
---

# Desktop Development Guide

## Architecture Overview

LobeChat desktop is built on Electron with main-renderer architecture:

1. **Main Process** (`apps/desktop/src/main`): App lifecycle, system APIs, window management
2. **Renderer Process**: Reuses web code from `src/`
3. **Preload Scripts** (`apps/desktop/src/preload`): Securely expose main process to renderer

## Adding New Desktop Features

### 1. Create Controller

Location: `apps/desktop/src/main/controllers/`

```typescript
import { ControllerModule, IpcMethod } from '@/controllers';

export default class NewFeatureCtr extends ControllerModule {
  static override readonly groupName = 'newFeature';

  @IpcMethod()
  async doSomething(params: SomeParams): Promise<SomeResult> {
    // Implementation
    return { success: true };
  }
}
```

Register in `apps/desktop/src/main/controllers/registry.ts`.

### 2. Define IPC Types

Location: `packages/electron-client-ipc/src/types.ts`

```typescript
export interface SomeParams {
  /* ... */
}
export interface SomeResult {
  success: boolean;
  error?: string;
}
```

### 3. Create Renderer Service

Location: `src/services/electron/`

```typescript
import { ensureElectronIpc } from '@/utils/electron/ipc';

const ipc = ensureElectronIpc();

export const newFeatureService = async (params: SomeParams) => {
  return ipc.newFeature.doSomething(params);
};
```

### 4. Implement Store Action

Location: `src/store/`

### 5. Add Tests

Location: `apps/desktop/src/main/controllers/__tests__/`

## Detailed Guides

See `references/` for specific topics:

- **Feature implementation**: `references/feature-implementation.md`
- **Local tools workflow**: `references/local-tools.md`
- **Menu configuration**: `references/menu-config.md`
- **Window management**: `references/window-management.md`

## Best Practices

1. **Security**: Validate inputs, limit exposed APIs
2. **Performance**: Use async methods, batch data transfers
3. **UX**: Add progress indicators, provide error feedback
4. **Code organization**: Follow existing patterns, add documentation

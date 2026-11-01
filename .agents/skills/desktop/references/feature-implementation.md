# Desktop Feature Implementation Guide

## Architecture Overview

```plaintext
Main Process                    Renderer Process
┌──────────────────┐           ┌──────────────────┐
│ Controller       │◄──IPC───►│ Service Layer    │
│ (IPC Handler)    │           │                  │
└──────────────────┘           └──────────────────┘
        │                              │
        ▼                              ▼
┌──────────────────┐           ┌──────────────────┐
│ System APIs      │           │ Store Actions    │
│ (fs, network)    │           │ (UI State)       │
└──────────────────┘           └──────────────────┘
```

## Step-by-Step Implementation

### 1. Create Controller

```typescript
// apps/desktop/src/main/controllers/NotificationCtr.ts
import type {
  ShowDesktopNotificationParams,
  DesktopNotificationResult,
} from '@lobechat/electron-client-ipc';
import { Notification } from 'electron';
import { ControllerModule, IpcMethod } from '@/controllers';

export default class NotificationCtr extends ControllerModule {
  static override readonly groupName = 'notification';

  @IpcMethod()
  async showDesktopNotification(
    params: ShowDesktopNotificationParams,
  ): Promise<DesktopNotificationResult> {
    if (!Notification.isSupported()) {
      return { error: 'Notifications not supported', success: false };
    }

    try {
      const notification = new Notification({ body: params.body, title: params.title });
      notification.show();
      return { success: true };
    } catch (error) {
      console.error('[NotificationCtr] Failed:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error', success: false };
    }
  }
}
```

### 2. Define IPC Types

```typescript
// packages/electron-client-ipc/src/types/notification.ts (re-exported from types/index.ts)
export interface ShowDesktopNotificationParams {
  title: string;
  body: string;
}

export interface DesktopNotificationResult {
  success: boolean;
  error?: string;
}
```

### 3. Create Service Layer

```typescript
// src/services/electron/desktopNotification.ts
import type { ShowDesktopNotificationParams } from '@lobechat/electron-client-ipc';
import { ensureElectronIpc } from '@/utils/electron/ipc';

export class DesktopNotificationService {
  async showNotification(params: ShowDesktopNotificationParams) {
    return ensureElectronIpc().notification.showDesktopNotification(params);
  }
}

export const desktopNotificationService = new DesktopNotificationService();
```

### 4. Implement Store Action

```typescript
// src/store/.../actions.ts
showNotification: async (title: string, body: string) => {
  if (!isElectron) return;

  const result = await desktopNotificationService.showNotification({ title, body });
  if (!result.success) {
    console.error('Notification failed:', result.error);
  }
},
```

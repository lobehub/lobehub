# Desktop Window Management Guide

## Window Management Overview

1. Window creation and configuration
2. Window state management (size, position, maximize)
3. Multi-window coordination
4. Window event handling

## File Structure

```plaintext
apps/desktop/src/main/
├── appBrowsers.ts              # Core window management
├── controllers/
│   └── BrowserWindowsCtr.ts    # Window controller
└── modules/
    └── browserWindowManager.ts # Window manager module
```

## Window Creation

```typescript
export const createMainWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  return mainWindow;
};
```

## Window State Persistence

```typescript
const saveWindowState = (window: BrowserWindow) => {
  if (!window.isMinimized() && !window.isMaximized()) {
    const [x, y] = window.getPosition();
    const [width, height] = window.getSize();
    settings.set('windowState', { x, y, width, height });
  }
};

const restoreWindowState = (window: BrowserWindow) => {
  const state = settings.get('windowState');
  if (state) {
    window.setBounds({ x: state.x, y: state.y, width: state.width, height: state.height });
  }
};

window.on('close', () => saveWindowState(window));
```

## Multi-Window Management

```typescript
export class WindowManager {
  private windows: Map<string, BrowserWindow> = new Map();

  createWindow(id: string, options: BrowserWindowConstructorOptions) {
    const window = new BrowserWindow(options);
    this.windows.set(id, window);
    window.on('closed', () => this.windows.delete(id));
    return window;
  }

  getWindow(id: string) {
    return this.windows.get(id);
  }
}
```

## Window IPC Controller

```typescript
// apps/desktop/src/main/controllers/BrowserWindowsCtr.ts
export default class BrowserWindowsCtr extends ControllerModule {
  static override readonly groupName = 'windows';

  @IpcMethod()
  minimizeWindow() {
    BrowserWindow.getFocusedWindow()?.minimize();
    return { success: true };
  }

  @IpcMethod()
  maximizeWindow() {
    const win = BrowserWindow.getFocusedWindow();
    win?.isMaximized() ? win.restore() : win?.maximize();
    return { success: true };
  }
}
```

## Renderer Service

```typescript
// src/services/electron/windowService.ts
import { ensureElectronIpc } from '@/utils/electron/ipc';

const ipc = ensureElectronIpc();

export const windowService = {
  minimize: () => ipc.windows.minimizeWindow(),
  maximize: () => ipc.windows.maximizeWindow(),
  close: () => ipc.windows.closeWindow(),
};
```

## Frameless Window

```typescript
const window = new BrowserWindow({
  frame: false,
  titleBarStyle: 'hidden',
});
```

```css
.titlebar {
  -webkit-app-region: drag;
}
.titlebar-button {
  -webkit-app-region: no-drag;
}
```

## Best Practices

1. Use `show: false` initially, show after content loads
2. Always set secure `webPreferences`
3. Handle `webContents.on('crashed')` for recovery
4. Clean up resources on `window.on('closed')`

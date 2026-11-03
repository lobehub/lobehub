# Desktop Menu Configuration Guide

## Menu Types

1. **App Menu**: Top of window (macOS) or title bar (Windows/Linux)
2. **Context Menu**: Right-click menus
3. **Tray Menu**: System tray icon menus

## File Structure

```plaintext
apps/desktop/src/main/
├── menus/
│   ├── appMenu.ts        # App menu config
│   ├── contextMenu.ts    # Context menu config
│   └── factory.ts        # Menu factory functions
├── controllers/
│   ├── MenuCtr.ts        # Menu controller
│   └── TrayMenuCtr.ts    # Tray menu controller
```

## App Menu Configuration

```typescript
// apps/desktop/src/main/menus/appMenu.ts
import { BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';

export const createAppMenu = (win: BrowserWindow) => {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            /* ... */
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    // ...
  ];

  return Menu.buildFromTemplate(template);
};

// Register in MenuCtr.ts
Menu.setApplicationMenu(menu);
```

## Context Menu

```typescript
export const createContextMenu = () => {
  const template = [
    { label: 'Copy', role: 'copy' },
    { label: 'Paste', role: 'paste' },
  ];
  return Menu.buildFromTemplate(template);
};

// Show on right-click
const menu = createContextMenu();
menu.popup();
```

## Tray Menu

```typescript
// TrayMenuCtr.ts
this.tray = new Tray(trayIconPath);
const contextMenu = Menu.buildFromTemplate([
  { label: 'Show Window', click: this.showMainWindow },
  { type: 'separator' },
  { label: 'Quit', click: () => app.quit() },
]);
this.tray.setContextMenu(contextMenu);
```

## i18n Support

```typescript
import { i18n } from '../locales';

const template = [
  {
    label: i18n.t('menu.file'),
    submenu: [{ label: i18n.t('menu.new'), click: createNew }],
  },
];
```

## Best Practices

1. Use standard roles (`role: 'copy'`) for native behavior
2. Use `CmdOrCtrl` for cross-platform shortcuts
3. Use `{ type: 'separator' }` to group related items
4. Handle platform differences with `process.platform`

```typescript
if (process.platform === 'darwin') {
  template.unshift({ role: 'appMenu' });
}
```

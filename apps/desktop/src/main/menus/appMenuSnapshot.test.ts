import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';

import { type AppMenuItemSource, assignMenuIds, serializeAppMenu } from './appMenuSnapshot';

const source = (overrides: Partial<AppMenuItemSource> = {}): AppMenuItemSource => ({
  checked: false,
  enabled: true,
  id: 'item',
  label: 'Item',
  type: 'normal',
  visible: true,
  ...overrides,
});

describe('assignMenuIds', () => {
  it('assigns path ids and keeps an id that is already set', () => {
    const template: MenuItemConstructorOptions[] = [
      {
        label: 'File',
        submenu: [
          { label: 'New Tab' },
          { type: 'separator' as const },
          { id: 'prefs', label: 'Settings' },
        ],
      },
      { type: 'separator' as const },
      { label: 'Edit' },
    ];

    assignMenuIds(template);

    expect(template[0]?.id).toBe('app-0');
    expect(template[0]?.submenu?.[0]?.id).toBe('app-0-0');
    expect(template[0]?.submenu?.[2]?.id).toBe('prefs');
    expect(template[2]?.id).toBe('app-2');
  });
});

describe('serializeAppMenu', () => {
  it('keeps labelled submenus and skips hidden accelerator aliases', () => {
    const nodes = serializeAppMenu([
      source({
        id: 'app-0',
        label: 'File',
        submenu: {
          items: [
            source({ accelerator: 'Ctrl+T', id: 'app-0-1', label: 'New Tab' }),
            source({ id: '', label: '', type: 'separator' }),
            source({ enabled: false, id: 'app-0-3', label: 'Checking for updates...' }),
          ],
        },
        type: 'submenu',
      }),
      source({
        id: 'app-2',
        label: 'View',
        submenu: {
          items: [
            source({ accelerator: 'CmdOrCtrl+=', id: 'zoom-in', label: 'Zoom In' }),
            source({
              accelerator: 'CmdOrCtrl+Plus',
              id: 'zoom-in-alias',
              label: 'Zoom In',
              visible: false,
            }),
          ],
        },
        type: 'submenu',
      }),
      source({ checked: true, id: 'trace', label: 'Trace', type: 'checkbox' }),
    ]);

    expect(nodes).toEqual([
      {
        children: [
          { accelerator: 'Ctrl+T', enabled: true, id: 'app-0-1', label: 'New Tab', type: 'normal' },
          { type: 'separator', enabled: false, id: '', label: '' },
          { enabled: false, id: 'app-0-3', label: 'Checking for updates...', type: 'normal' },
        ],
        enabled: true,
        id: 'app-0',
        label: 'File',
        type: 'submenu',
      },
      {
        children: [
          {
            accelerator: 'CmdOrCtrl+=',
            enabled: true,
            id: 'zoom-in',
            label: 'Zoom In',
            type: 'normal',
          },
        ],
        enabled: true,
        id: 'app-2',
        label: 'View',
        type: 'submenu',
      },
      { checked: true, enabled: true, id: 'trace', label: 'Trace', type: 'checkbox' },
    ]);
  });

  it('drops separators that only surrounded hidden items', () => {
    expect(
      serializeAppMenu([
        source({ id: 'a', label: 'A' }),
        source({ id: '', label: '', type: 'separator' }),
        source({ id: 'hidden', label: 'Hidden', visible: false }),
        source({ id: '', label: '', type: 'separator' }),
        source({ id: 'b', label: 'B' }),
        source({ id: '', label: '', type: 'separator' }),
      ]),
    ).toEqual([
      { enabled: true, id: 'a', label: 'A', type: 'normal' },
      { enabled: false, id: '', label: '', type: 'separator' },
      { enabled: true, id: 'b', label: 'B', type: 'normal' },
    ]);
  });
});

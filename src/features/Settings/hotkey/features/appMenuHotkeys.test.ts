import type { AppMenuNode } from '@lobechat/electron-client-ipc';
import { describe, expect, it } from 'vitest';

import { acceleratorToHotkey, collectAppMenuHotkeys } from './appMenuHotkeys';

describe('acceleratorToHotkey', () => {
  it.each([
    ['Alt+Ctrl+A', 'alt+ctrl+a'],
    ['Alt+Command+A', 'alt+meta+a'],
    ['CmdOrCtrl+W', 'mod+w'],
    ['CommandOrControl+,', 'mod+comma'],
    ['Shift+Command+H', 'shift+meta+h'],
    ['Command+[', 'meta+bracketleft'],
    ['Command+]', 'meta+bracketright'],
    ['CmdOrCtrl+=', 'mod+equal'],
    ['CmdOrCtrl+-', 'mod+minus'],
    ['CmdOrCtrl+Plus', 'mod+equal'],
    ['CmdOrCtrl++', 'mod+equal'],
    ['CmdOrCtrl+Shift+R', 'mod+shift+r'],
    ['Alt+Left', 'alt+left'],
    ['F12', 'f12'],
  ])('%s -> %s', (accelerator, expected) => {
    expect(acceleratorToHotkey(accelerator)).toBe(expected);
  });
});

describe('collectAppMenuHotkeys', () => {
  const item = (id: string, label: string, accelerator?: string): AppMenuNode => ({
    accelerator,
    enabled: true,
    id,
    label,
    type: 'normal',
  });

  it('keeps only accelerator items in menu order, tagged with their top-level menu', () => {
    const nodes: AppMenuNode[] = [
      {
        children: [
          item('new-topic', 'New Topic', 'Ctrl+N'),
          { enabled: false, id: '', label: '', type: 'separator' },
          item('new-agent', 'New Agent', 'Alt+Ctrl+A'),
          item('preferences', 'Preferences'),
        ],
        enabled: true,
        id: 'file',
        label: 'File',
        type: 'submenu',
      },
      {
        children: [item('undo', 'Undo')],
        enabled: true,
        id: 'edit',
        label: 'Edit',
        type: 'submenu',
      },
      {
        children: [
          {
            children: [item('zoom-in', 'Zoom In', 'CmdOrCtrl+=')],
            enabled: true,
            id: 'zoom',
            label: 'Zoom',
            type: 'submenu',
          },
        ],
        enabled: true,
        id: 'view',
        label: 'View',
        type: 'submenu',
      },
    ];

    expect(collectAppMenuHotkeys(nodes)).toEqual([
      { id: 'new-topic', keys: 'ctrl+n', label: 'New Topic', menu: 'File' },
      { id: 'new-agent', keys: 'alt+ctrl+a', label: 'New Agent', menu: 'File' },
      { id: 'zoom-in', keys: 'mod+equal', label: 'Zoom In', menu: 'View' },
    ]);
  });

  it('lists an item repeated across menus once, under its first menu', () => {
    const nodes: AppMenuNode[] = [
      {
        children: [item('file-close', 'Close', 'Ctrl+W')],
        enabled: true,
        id: 'file',
        label: 'File',
        type: 'submenu',
      },
      {
        children: [item('window-close', 'Close', 'Ctrl+W'), item('min', 'Minimize', 'Ctrl+M')],
        enabled: true,
        id: 'window',
        label: 'Window',
        type: 'submenu',
      },
    ];

    expect(collectAppMenuHotkeys(nodes)).toEqual([
      { id: 'file-close', keys: 'ctrl+w', label: 'Close', menu: 'File' },
      { id: 'min', keys: 'ctrl+m', label: 'Minimize', menu: 'Window' },
    ]);
  });
});

import type { AppMenuNode } from '@lobechat/electron-client-ipc';
import { describe, expect, it, vi } from 'vitest';

import { formatMenuAccelerator, toAppMenuDropdownItems } from './appMenuItems';

describe('formatMenuAccelerator', () => {
  it('shows Windows modifiers', () => {
    expect(formatMenuAccelerator('CmdOrCtrl+Shift+H')).toBe('Ctrl+Shift+H');
    expect(formatMenuAccelerator('CommandOrControl+Plus')).toBe('Ctrl++');
    expect(formatMenuAccelerator(undefined)).toBeUndefined();
  });
});

describe('toAppMenuDropdownItems', () => {
  const nodes: AppMenuNode[] = [
    {
      children: [
        { accelerator: 'Ctrl+T', enabled: true, id: 'new-tab', label: 'New Tab', type: 'normal' },
        { enabled: false, id: '', label: '', type: 'separator' },
        { enabled: false, id: 'updates', label: 'Checking for updates...', type: 'normal' },
      ],
      enabled: true,
      id: 'file',
      label: 'File',
      type: 'submenu',
    },
    { checked: true, enabled: true, id: 'trace', label: 'Trace', type: 'checkbox' },
  ];

  it('builds nested menu rows and invokes the clicked id', () => {
    const invoke = vi.fn();
    const items = toAppMenuDropdownItems(nodes, invoke);
    const file = items[0];

    expect(file).toMatchObject({ key: 'file', label: 'File', openOnHover: true, type: 'submenu' });
    if (file?.type !== 'submenu') throw new Error('expected File submenu');

    const newTab = file.children?.[0];
    expect(newTab).toMatchObject({ extra: 'Ctrl+T', key: 'new-tab', label: 'New Tab' });
    if (!newTab || !('onClick' in newTab) || !newTab.onClick) throw new Error('expected click');

    newTab.onClick({} as never);
    expect(invoke).toHaveBeenCalledWith('new-tab');

    expect(file.children?.[1]).toMatchObject({ type: 'divider' });
    expect(file.children?.[2]).toMatchObject({ disabled: true, key: 'updates' });

    const trace = items[1];
    expect(trace).toMatchObject({ checked: true, key: 'trace', type: 'checkbox' });
    if (!trace || !('onCheckedChange' in trace) || !trace.onCheckedChange) {
      throw new Error('expected checkbox');
    }

    trace.onCheckedChange(false);
    expect(invoke).toHaveBeenCalledWith('trace');
  });
});

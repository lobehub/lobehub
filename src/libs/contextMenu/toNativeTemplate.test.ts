import { describe, expect, it, vi } from 'vitest';

import { toNativeTemplate } from './toNativeTemplate';
import type { NativeContextMenuItem } from './types';

describe('toNativeTemplate', () => {
  it('maps a divider to a separator', () => {
    const { template } = toNativeTemplate([{ type: 'divider' }]);
    expect(template).toEqual([{ type: 'separator' }]);
  });

  it('maps children to a submenu', () => {
    const { template } = toNativeTemplate([
      { children: [{ key: '1', label: 'Copy' }], key: 'root', label: 'File' },
    ]);
    expect(template).toEqual([
      {
        label: 'File',
        submenu: [{ id: '0.0', label: 'Copy', type: 'normal' }],
        type: 'submenu',
      },
    ]);
  });

  it('treats an item with undefined children as a plain actionable item, not an inert submenu', () => {
    const onClick = vi.fn();
    const { template, handlers } = toNativeTemplate([
      { children: undefined, key: '1', label: 'Delete', onClick },
    ]);

    expect(template).toEqual([{ id: '0', label: 'Delete', type: 'normal' }]);

    handlers.get('0')?.();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('maps a checkbox item and its checked state', () => {
    const { template } = toNativeTemplate([
      { checked: true, key: '1', label: 'Wrap', type: 'checkbox' },
    ]);
    expect(template).toEqual([{ checked: true, id: '0', label: 'Wrap', type: 'checkbox' }]);
  });

  it('falls back to defaultChecked when checked is uncontrolled, and reports the correct toggled value', () => {
    const onCheckedChange = vi.fn();
    const { template, handlers } = toNativeTemplate([
      { defaultChecked: true, key: '1', label: 'Wrap', onCheckedChange, type: 'checkbox' },
    ]);

    expect(template).toEqual([{ checked: true, id: '0', label: 'Wrap', type: 'checkbox' }]);

    handlers.get('0')?.();
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('maps a string desc to sublabel', () => {
    const { template } = toNativeTemplate([{ desc: 'Ctrl+C', key: '1', label: 'Copy' }]);
    expect(template).toEqual([{ id: '0', label: 'Copy', sublabel: 'Ctrl+C', type: 'normal' }]);
  });

  it('maps disabled to enabled: false', () => {
    const { template } = toNativeTemplate([{ disabled: true, key: '1', label: 'Copy' }]);
    expect(template).toEqual([{ enabled: false, id: '0', label: 'Copy', type: 'normal' }]);
  });

  it('stringifies a numeric label', () => {
    const { template } = toNativeTemplate([{ key: '1', label: 42 }]);
    expect(template[0].label).toBe('42');
  });

  it('passes sfSymbol through unchanged', () => {
    const { template } = toNativeTemplate([{ key: '1', label: 'Copy', sfSymbol: 'doc.on.doc' }]);
    expect(template[0].sfSymbol).toBe('doc.on.doc');
  });

  it('flattens a group into a header followed by its children as siblings', () => {
    const { template } = toNativeTemplate([
      {
        children: [
          { key: 'a', label: 'A' },
          { key: 'b', label: 'B' },
        ],
        label: 'Section',
        type: 'group',
      },
    ]);
    expect(template).toEqual([
      { type: 'header', label: 'Section' },
      { id: '0.0', label: 'A', type: 'normal' },
      { id: '0.1', label: 'B', type: 'normal' },
    ]);
  });

  it('flattens an unlabeled group into just its children, with no header row', () => {
    const { template } = toNativeTemplate([
      {
        children: [
          { key: 'a', label: 'A' },
          { key: 'b', label: 'B' },
        ],
        type: 'group',
      },
    ]);
    expect(template).toEqual([
      { id: '0.0', label: 'A', type: 'normal' },
      { id: '0.1', label: 'B', type: 'normal' },
    ]);
  });

  it('assigns tree-path ids and keeps ids stable across duplicate sibling keys at different levels', () => {
    const { template } = toNativeTemplate([
      {
        children: [
          {
            children: [{ key: 'dup', label: 'Deep' }],
            key: 'dup',
            label: 'Nested',
          },
        ],
        key: 'dup',
        label: 'Top',
      },
    ]);
    expect(template[0].id).toBeUndefined();
    expect(template[0].submenu?.[0].id).toBeUndefined();
    expect(template[0].submenu?.[0].submenu?.[0].id).toBe('0.0.0');
  });

  it('fires the right onClick handler with a synthetic MenuInfo whose domEvent supports stopPropagation', () => {
    const onClickA = vi.fn();
    const onClickB = vi.fn();
    const { handlers } = toNativeTemplate([
      { key: 'a', label: 'A', onClick: onClickA },
      { key: 'b', label: 'B', onClick: onClickB },
    ]);

    handlers.get('1')?.();

    expect(onClickA).not.toHaveBeenCalled();
    expect(onClickB).toHaveBeenCalledTimes(1);

    const info = onClickB.mock.calls[0][0];
    expect(info.key).toBe('b');
    expect(() => info.domEvent.stopPropagation()).not.toThrow();
  });

  it('invokes onCheckedChange with the toggled value', () => {
    const onCheckedChange = vi.fn();
    const { handlers } = toNativeTemplate([
      { checked: true, key: '1', label: 'Wrap', onCheckedChange, type: 'checkbox' },
    ]);

    handlers.get('0')?.();

    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('drops icon, danger and popupClassName from the output', () => {
    const items = [
      {
        danger: true,
        icon: 'ShouldNotAppear',
        key: '1',
        label: 'Delete',
        popupClassName: 'ShouldNotAppearEither',
      },
    ] as unknown as NativeContextMenuItem[];
    const { template } = toNativeTemplate(items);
    const serialized = JSON.stringify(template);
    expect(serialized).not.toContain('ShouldNotAppear');
    expect(serialized).not.toContain('danger');
    expect(serialized).not.toContain('icon');
    expect(serialized).not.toContain('popupClassName');
  });

  it('drops null items', () => {
    const { template } = toNativeTemplate([null, { key: '1', label: 'Copy' }]);
    expect(template).toEqual([{ id: '1', label: 'Copy', type: 'normal' }]);
  });

  it('produces a structured-cloneable template', () => {
    const { template } = toNativeTemplate([
      {
        children: [
          { checked: true, key: 'a', label: 'A', onCheckedChange: () => {}, type: 'checkbox' },
          { type: 'divider' },
        ],
        key: 'root',
        label: 'Root',
        onClick: () => {},
      },
    ]);
    expect(() => structuredClone(template)).not.toThrow();
  });
});

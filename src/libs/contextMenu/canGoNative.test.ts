import { describe, expect, it } from 'vitest';

import { canGoNative } from './canGoNative';
import type { NativeContextMenuItem } from './types';

describe('canGoNative', () => {
  describe('accepts', () => {
    it('a plain normal item', () => {
      expect(canGoNative([{ key: '1', label: 'Copy' }])).toBe(true);
    });

    it('a divider', () => {
      expect(canGoNative([{ type: 'divider' }])).toBe(true);
    });

    it('a group with plain children', () => {
      expect(canGoNative([{ children: [{ key: '1', label: 'Copy' }], type: 'group' }])).toBe(true);
    });

    it('a checkbox item', () => {
      expect(canGoNative([{ checked: true, key: '1', label: 'Wrap', type: 'checkbox' }])).toBe(
        true,
      );
    });

    it('an item with sfSymbol present', () => {
      expect(canGoNative([{ key: '1', label: 'Copy', sfSymbol: 'doc.on.doc' }])).toBe(true);
    });

    it('an item with a string desc', () => {
      expect(canGoNative([{ desc: 'Ctrl+C', key: '1', label: 'Copy' }])).toBe(true);
    });

    it('an item with a numeric label', () => {
      expect(canGoNative([{ key: '1', label: 42 }])).toBe(true);
    });

    it('a group with an empty children array (unlike a submenu, an empty group is not rejected)', () => {
      expect(canGoNative([{ children: [], type: 'group' }])).toBe(true);
    });
  });

  describe('rejects', () => {
    it('a switch item', () => {
      expect(canGoNative([{ checked: true, key: '1', label: 'Auto save', type: 'switch' }])).toBe(
        false,
      );
    });

    it('an item with non-empty extra', () => {
      const items = [
        { extra: '1', key: '1', label: 'Delete' },
      ] as unknown as NativeContextMenuItem[];
      expect(canGoNative(items)).toBe(false);
    });

    it('a loading item', () => {
      const items = [
        { key: '1', label: 'Save', loading: true },
      ] as unknown as NativeContextMenuItem[];
      expect(canGoNative(items)).toBe(false);
    });

    it('an item whose label is not a string/number', () => {
      const items = [
        { key: '1', label: { toString: () => 'react-node-ish' } },
      ] as unknown as NativeContextMenuItem[];
      expect(canGoNative(items)).toBe(false);
    });

    it('an item whose desc is present but not a string', () => {
      const items = [{ desc: 42, key: '1', label: 'Copy' }] as unknown as NativeContextMenuItem[];
      expect(canGoNative(items)).toBe(false);
    });

    it('a reject-rule hit inside a second-level submenu', () => {
      const items: NativeContextMenuItem[] = [
        {
          children: [
            {
              children: [{ key: '1-1-1', label: 'Delete', loading: true } as never],
              key: '1-1',
              label: 'Nested',
            },
          ],
          key: '1',
          label: 'Top',
        },
      ];
      expect(canGoNative(items)).toBe(false);
    });

    it('a reject-rule hit inside a group child', () => {
      const items: NativeContextMenuItem[] = [
        {
          children: [{ checked: true, key: '1', label: 'Toggle', type: 'switch' }],
          type: 'group',
        },
      ];
      expect(canGoNative(items)).toBe(false);
    });

    it('when options.header is set', () => {
      expect(canGoNative([{ key: '1', label: 'Copy' }], { header: 'Header' })).toBe(false);
    });

    it('when options.footer is set', () => {
      expect(canGoNative([{ key: '1', label: 'Copy' }], { footer: 'Footer' })).toBe(false);
    });

    it('a submenu-shaped item with an empty children array', () => {
      const items: NativeContextMenuItem[] = [{ children: [], key: '1', label: 'Empty submenu' }];
      expect(canGoNative(items)).toBe(false);
    });

    it('a type: submenu item with no children field at all', () => {
      const items: NativeContextMenuItem[] = [
        { key: '1', label: 'Empty submenu', type: 'submenu' },
      ];
      expect(canGoNative(items)).toBe(false);
    });

    it('an item with closeOnClick: false', () => {
      const items: NativeContextMenuItem[] = [{ closeOnClick: false, key: '1', label: 'Upload' }];
      expect(canGoNative(items)).toBe(false);
    });

    it('a submenu item carrying an item-level header slot', () => {
      const items: NativeContextMenuItem[] = [
        {
          children: [{ key: '1-1', label: 'Child' }],
          header: 'Pinned header',
          key: '1',
          label: 'File',
        },
      ];
      expect(canGoNative(items)).toBe(false);
    });

    it('a submenu item carrying an item-level footer slot', () => {
      const items: NativeContextMenuItem[] = [
        {
          children: [{ key: '1-1', label: 'Child' }],
          footer: 'Pinned footer',
          key: '1',
          label: 'File',
        },
      ];
      expect(canGoNative(items)).toBe(false);
    });
  });

  it('skips null items without rejecting the menu', () => {
    expect(canGoNative([null, { key: '1', label: 'Copy' }])).toBe(true);
  });
});

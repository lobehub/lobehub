import { describe, expect, it, vi } from 'vitest';

import { buildPortalMoreMenuItems } from './buildItems';
import { type PortalMoreMenuConfig } from './types';

const t = (key: string) => `t:${key}`;

const build = (config: PortalMoreMenuConfig | undefined, copy = vi.fn()) =>
  buildPortalMoreMenuItems(config, { copy, t });

const keysOf = (items: ReturnType<typeof build>) =>
  items.map((item) => (item && 'type' in item && item.type === 'divider' ? '|' : item?.key));

describe('buildPortalMoreMenuItems', () => {
  it('renders nothing without a config or with no capability declared', () => {
    expect(build(undefined)).toEqual([]);
    expect(build({})).toEqual([]);
  });

  it('orders every capability in the shared fixed order with group dividers', () => {
    const items = build({
      copyId: 'id_1',
      copyLink: 'https://app.lobehub.com/x',
      delete: vi.fn(),
      extraItems: [{ key: 'download', label: 'Download' }],
      openInPage: vi.fn(),
      refresh: vi.fn(),
      rename: vi.fn(),
    });

    expect(keysOf(items)).toEqual([
      'rename',
      '|',
      'copyLink',
      'copyId',
      'openInPage',
      'refresh',
      '|',
      'download',
      '|',
      'delete',
    ]);
  });

  it('ignores the declaration order of the config', () => {
    const items = build({
      delete: vi.fn(),
      refresh: vi.fn(),
      copyId: 'id_1',
      rename: vi.fn(),
    });

    expect(keysOf(items)).toEqual(['rename', '|', 'copyId', 'refresh', '|', 'delete']);
  });

  it('hides unsupported capabilities instead of disabling them', () => {
    const items = build({ copyId: 'id_1', copyLink: undefined, delete: undefined });

    expect(keysOf(items)).toEqual(['copyId']);
    expect(items.some((item) => item && 'disabled' in item && item.disabled)).toBe(false);
  });

  it('drops the divider of an empty group (no leading or doubled dividers)', () => {
    expect(keysOf(build({ delete: vi.fn(), refresh: vi.fn() }))).toEqual([
      'refresh',
      '|',
      'delete',
    ]);
    expect(keysOf(build({ delete: vi.fn() }))).toEqual(['delete']);
    expect(keysOf(build({ extraItems: [], rename: vi.fn() }))).toEqual(['rename']);
  });

  it('labels items from the portal namespace and marks delete as danger', () => {
    const items = build({ delete: vi.fn(), rename: vi.fn() });

    expect(items[0]).toMatchObject({ label: 't:moreMenu.rename' });
    expect(items.at(-1)).toMatchObject({ danger: true, label: 't:moreMenu.delete' });
  });

  it('copies link and id with their own success messages', () => {
    const copy = vi.fn();
    const items = build({ copyId: 'id_1', copyLink: 'https://app.lobehub.com/x' }, copy);

    (items[0] as any).onClick();
    (items[1] as any).onClick();

    expect(copy).toHaveBeenNthCalledWith(
      1,
      'https://app.lobehub.com/x',
      'moreMenu.copyLinkSuccess',
    );
    expect(copy).toHaveBeenNthCalledWith(2, 'id_1', 'moreMenu.copyIdSuccess');
  });

  it('wires action capabilities straight to their handlers', () => {
    const config = {
      delete: vi.fn(),
      openInPage: vi.fn(),
      refresh: vi.fn(),
      rename: vi.fn(),
    };
    const items = build(config);
    const byKey = (key: string) => items.find((item) => item?.key === key) as any;

    byKey('rename').onClick();
    byKey('openInPage').onClick();
    byKey('refresh').onClick();
    byKey('delete').onClick();

    expect(config.rename).toHaveBeenCalledOnce();
    expect(config.openInPage).toHaveBeenCalledOnce();
    expect(config.refresh).toHaveBeenCalledOnce();
    expect(config.delete).toHaveBeenCalledOnce();
  });
});

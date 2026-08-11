import type { HomeSidebarIndex, HomeSidebarProjectionRef } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveHomeAgentRows } from './useHomeAgentRows';

const UPDATED_AT = new Date('2026-07-31T00:00:00.000Z');

const ref = (
  id: string,
  options: Partial<HomeSidebarProjectionRef> = {},
): HomeSidebarProjectionRef => ({
  id,
  kind: 'agent',
  pinned: false,
  updatedAt: UPDATED_AT,
  ...options,
});

const index = (overrides: Partial<HomeSidebarIndex> = {}): HomeSidebarIndex => ({
  groups: [],
  key: 'home.sidebar',
  observedAt: 1,
  pinned: [],
  privateGroups: [],
  privatePinned: [],
  privateUngrouped: [],
  source: 'network',
  ungrouped: [],
  ...overrides,
});

const keepAll = <T>(items: T[]): T[] => items;
const hide = (ids: string[]) => {
  const hidden = new Set(ids);
  return (items: HomeSidebarProjectionRef[]) => items.filter((item) => !hidden.has(item.id));
};
const hideGroups = (ids: string[]) => {
  const hidden = new Set(ids);
  return <T extends { id: string }>(groups: T[]) => groups.filter((group) => !hidden.has(group.id));
};
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe('resolveHomeAgentRows', () => {
  it('keeps loading explicit until the normalized sidebar index exists', () => {
    const result = resolveHomeAgentRows(undefined, 'agt_inbox', undefined, keepAll);

    expect(result.isInitialized).toBe(false);
    expect(ids(result.workspaceRows)).toEqual(['agt_inbox']);
  });

  it('honors the caller visibility filter before bucketing agents', () => {
    const result = resolveHomeAgentRows(
      index({ ungrouped: [ref('agt_a'), ref('agt_b')] }),
      'agt_inbox',
      undefined,
      hide(['agt_b']),
    );

    expect(ids(result.workspaceRows)).toEqual(['agt_inbox', 'agt_a']);
  });

  it('drops hidden private agents too', () => {
    const result = resolveHomeAgentRows(
      index({ privateUngrouped: [ref('agt_p1'), ref('agt_p2')] }),
      'agt_inbox',
      'ws_1',
      hide(['agt_p2']),
    );

    expect(ids(result.privateRows)).toEqual(['agt_p1']);
  });

  it('drops the agents inside a Category the caller hid', () => {
    const result = resolveHomeAgentRows(
      index({
        groups: [
          { id: 'grp_shown', items: [ref('agt_shown')], name: 'Shown', sort: 0 },
          { id: 'grp_hidden', items: [ref('agt_in_hidden')], name: 'Hidden', sort: 1 },
        ],
      }),
      'agt_inbox',
      'ws_1',
      keepAll,
      hideGroups(['grp_hidden']),
    );

    expect(ids(result.workspaceRows)).toEqual(['agt_inbox', 'agt_shown']);
  });

  it('splits private and workspace refs inside a workspace', () => {
    const result = resolveHomeAgentRows(
      index({ privateUngrouped: [ref('agt_p')], ungrouped: [ref('agt_a')] }),
      'agt_inbox',
      'ws_1',
      keepAll,
    );

    expect(result.showPrivateSection).toBe(true);
    expect(ids(result.privateRows)).toEqual(['agt_p']);
    expect(ids(result.workspaceRows)).toEqual(['agt_inbox', 'agt_a']);
  });

  it('keeps a single flat bucket in personal mode', () => {
    const result = resolveHomeAgentRows(
      index({ ungrouped: [ref('agt_a')] }),
      'agt_inbox',
      undefined,
      keepAll,
    );

    expect(result.showPrivateSection).toBe(false);
    expect(result.privateRows).toEqual([]);
    expect(ids(result.workspaceRows)).toEqual(['agt_inbox', 'agt_a']);
  });

  it('hides the private section when every private agent is hidden', () => {
    const result = resolveHomeAgentRows(
      index({ privateUngrouped: [ref('agt_p')] }),
      'agt_inbox',
      'ws_1',
      hide(['agt_p']),
    );

    expect(result.showPrivateSection).toBe(false);
    expect(result.privateRows).toEqual([]);
  });

  it('orders pinned, grouped, then ungrouped refs and de-duplicates by id', () => {
    const pinned = ref('agt_pinned', { pinned: true });
    const result = resolveHomeAgentRows(
      index({
        groups: [
          {
            id: 'grp_1',
            items: [pinned, ref('agt_folder')],
            name: 'Folder',
            sort: 0,
          },
        ],
        pinned: [pinned],
        ungrouped: [ref('agt_plain')],
      }),
      'agt_inbox',
      undefined,
      keepAll,
    );

    expect(ids(result.workspaceRows)).toEqual([
      'agt_inbox',
      'agt_pinned',
      'agt_folder',
      'agt_plain',
    ]);
    expect(result.workspaceRows.find((row) => row.id === 'agt_pinned')?.pinned).toBe(true);
  });

  it('excludes chat groups so only Agent ids reach the Home input', () => {
    const result = resolveHomeAgentRows(
      index({ ungrouped: [ref('agt_a'), ref('grp_chat', { kind: 'chatGroup' })] }),
      'agt_inbox',
      undefined,
      keepAll,
    );

    expect(ids(result.workspaceRows)).toEqual(['agt_inbox', 'agt_a']);
  });
});

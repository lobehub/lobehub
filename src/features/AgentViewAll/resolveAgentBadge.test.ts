import type { SidebarAgentItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveAgentBadge } from './resolveAgentBadge';

const agent = (overrides: Partial<SidebarAgentItem> = {}): SidebarAgentItem => ({
  id: 'agt_1',
  pinned: false,
  title: 'Agent',
  type: 'agent',
  updatedAt: new Date(0),
  ...overrides,
});

describe('resolveAgentBadge', () => {
  it('keeps a regular agent clean', () => {
    expect(resolveAgentBadge(agent())).toEqual({});
  });

  it('adds a cover only when the agent picked an avatar background color', () => {
    expect(resolveAgentBadge(agent({ backgroundColor: '#3b82f6' })).cover).toBe('#3b82f6');
    expect(resolveAgentBadge(agent({ backgroundColor: '  ' })).cover).toBeUndefined();
    expect(resolveAgentBadge(agent({ backgroundColor: null })).cover).toBeUndefined();
    // The swatch picker's "default" entry stores transparent black.
    expect(resolveAgentBadge(agent({ backgroundColor: 'rgba(0, 0, 0, 0)' })).cover).toBeUndefined();
  });

  it('marks builtin agents official before pinned ones core', () => {
    expect(resolveAgentBadge(agent({ slug: 'inbox' })).bottom).toBe('official');
    expect(resolveAgentBadge(agent({ pinned: true, slug: 'inbox' })).bottom).toBe('official');
    expect(resolveAgentBadge(agent({ pinned: true })).bottom).toBe('core');
    expect(resolveAgentBadge(agent({ slug: 'my-custom-agent' })).bottom).toBeUndefined();
  });

  it('gives the arch only to agents carrying an event or limited label', () => {
    const badge = resolveAgentBadge(
      agent({
        labels: [
          { color: '#3b82f6', id: 'l1', name: '研发' },
          { color: '#8b5cf6', id: 'l2', name: 'Hackathon 2026' },
        ],
      }),
    );
    expect(badge.top).toEqual({ color: '#8b5cf6', label: 'Hackathon 2026' });

    expect(resolveAgentBadge(agent({ labels: [{ id: 'l3', name: '限定' }] })).top).toEqual({
      color: undefined,
      label: '限定',
    });
    expect(resolveAgentBadge(agent({ labels: [{ id: 'l1', name: '研发' }] })).top).toBeUndefined();
    // Whole words only: ordinary labels that merely contain the keywords stay clean.
    for (const name of ['Unlimited', 'Prevention', 'Eventual'])
      expect(resolveAgentBadge(agent({ labels: [{ id: 'l4', name }] })).top).toBeUndefined();
    expect(
      resolveAgentBadge(agent({ labels: [{ id: 'l5', name: 'Spring Event' }] })).top?.label,
    ).toBe('Spring Event');
  });
});

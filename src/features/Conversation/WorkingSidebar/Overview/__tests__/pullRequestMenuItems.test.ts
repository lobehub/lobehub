import type { TopicPullRequestAutoFix } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import {
  buildPullRequestMenuItems,
  describeAutoFix,
  type PullRequestMenuParams,
  resolveAutoFixAvailability,
} from '../pullRequestMenuItems';

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

const autoFix = (overrides: Partial<TopicPullRequestAutoFix> = {}): TopicPullRequestAutoFix => ({
  changeRequestId: 'scr-1',
  enabled: true,
  maxWakes: 3,
  ownerTopic: null,
  ownerTopicId: 'tpc-here',
  wakeCount: 0,
  ...overrides,
});

const handlers = () => ({
  onCopyLink: vi.fn(),
  onDismiss: vi.fn(),
  onOpenOnGithub: vi.fn(),
  onOpenOwnerTopic: vi.fn(),
  onToggleAutoFix: vi.fn(),
});

const build = (overrides: Partial<PullRequestMenuParams> = {}) =>
  buildPullRequestMenuItems({
    availability: resolveAutoFixAvailability(autoFix(), 'tpc-here'),
    ...handlers(),
    t,
    ...overrides,
  });

const flatten = (items: ReturnType<typeof build>): any[] =>
  items.flatMap((item: any) => (item?.type === 'group' ? [item, ...item.children] : [item]));

const byKey = (items: ReturnType<typeof build>, key: string) =>
  flatten(items).find((item) => item && 'key' in item && item.key === key);

const keysOf = (items: ReturnType<typeof build>) =>
  items.map((item: any) =>
    item?.type === 'group'
      ? item.children.map((child: any) => child.key)
      : (item?.key ?? item?.type),
  );

describe('resolveAutoFixAvailability', () => {
  it('is switchable only from the conversation it wakes', () => {
    expect(resolveAutoFixAvailability(autoFix({ wakeCount: 2 }), 'tpc-here')).toEqual({
      changeRequestId: 'scr-1',
      enabled: true,
      kind: 'own',
      maxWakes: 3,
      wakeCount: 2,
    });
  });

  it('needs the GitHub App, a linked conversation, and that it is this one', () => {
    expect(resolveAutoFixAvailability(undefined, 'tpc-here')).toEqual({ kind: 'noApp' });
    expect(resolveAutoFixAvailability(autoFix({ ownerTopicId: null }), 'tpc-here')).toEqual({
      kind: 'unlinked',
    });
    const ownerTopic = { agentId: 'agt-2', id: 'tpc-other', title: 'Other' };
    expect(
      resolveAutoFixAvailability(autoFix({ ownerTopic, ownerTopicId: 'tpc-other' }), 'tpc-here'),
    ).toEqual({ kind: 'otherTopic', ownerTopic });
    // A new conversation has no topic yet: whatever the PR wakes, it is not this.
    expect(resolveAutoFixAvailability(autoFix(), undefined)).toMatchObject({
      kind: 'otherTopic',
    });
  });
});

describe('describeAutoFix', () => {
  const own = (enabled: boolean, wakeCount: number) =>
    resolveAutoFixAvailability(autoFix({ enabled, wakeCount }), 'tpc-here');

  it('explains what it does, then how far it has got', () => {
    expect(describeAutoFix(own(true, 0), t)).toBe('workingPanel.overview.pr.autoFix.desc');
    expect(describeAutoFix(own(true, 1), t)).toBe(
      'workingPanel.overview.pr.autoFix.woken {"count":1,"max":3}',
    );
    expect(describeAutoFix(own(true, 3), t)).toBe(
      'workingPanel.overview.pr.autoFix.capped {"count":3,"max":3}',
    );
    // Off with wakes spent: turning it on starts over.
    expect(describeAutoFix(own(false, 3), t)).toBe(
      'workingPanel.overview.pr.autoFix.resetOnEnable {"count":3,"max":3}',
    );
  });

  it('says why it cannot be switched here', () => {
    expect(describeAutoFix({ kind: 'noApp' }, t)).toBe('workingPanel.overview.pr.autoFix.noApp');
    expect(describeAutoFix({ kind: 'unlinked' }, t)).toBe(
      'workingPanel.overview.pr.autoFix.unlinked',
    );
    expect(
      describeAutoFix(
        { kind: 'otherTopic', ownerTopic: { agentId: 'a', id: 'tpc-2', title: ' Fix CI ' } },
        t,
      ),
    ).toBe('workingPanel.overview.pr.autoFix.otherTopic {"title":"Fix CI"}');
    // Not one the viewer can open, or untitled: no name to give.
    expect(describeAutoFix({ kind: 'otherTopic', ownerTopic: null }, t)).toBe(
      'workingPanel.overview.pr.autoFix.otherTopicHidden',
    );
    expect(
      describeAutoFix(
        { kind: 'otherTopic', ownerTopic: { agentId: 'a', id: 'x', title: null } },
        t,
      ),
    ).toBe('workingPanel.overview.pr.autoFix.otherTopicHidden');
  });
});

describe('buildPullRequestMenuItems', () => {
  it('lists open, copy, Auto-fix and remove, with dividers between the groups', () => {
    const items = build();
    expect(keysOf(items)).toEqual([
      'openOnGithub',
      'copyLink',
      'divider',
      ['autoFix'],
      'divider',
      'dismiss',
    ]);
    expect(byKey(items, 'dismiss')).toMatchObject({ danger: true });
  });

  it('puts the Auto-fix mark in the leading slot: alone in its group, with no icon beside it', () => {
    // lobe-ui moves a checkbox's mark to the right edge when its list also
    // holds items with icons; the Auto-fix group must hold only checkboxes.
    const ownerTopic = { agentId: 'agt-2', id: 'tpc-other', title: 'Other' };
    for (const availability of [
      resolveAutoFixAvailability(autoFix(), 'tpc-here'),
      resolveAutoFixAvailability(autoFix({ ownerTopic, ownerTopicId: 'tpc-other' }), 'tpc-here'),
    ]) {
      const group = build({ availability }).find((item: any) => item?.type === 'group') as any;
      expect(group.children).toHaveLength(1);
      expect(group.children[0]).toMatchObject({ key: 'autoFix', type: 'checkbox' });
      expect(group.children.some((child: any) => child.icon)).toBe(false);
    }
  });

  it('runs each handler from its item', () => {
    const h = handlers();
    const items = build(h);

    byKey(items, 'openOnGithub').onClick();
    byKey(items, 'copyLink').onClick();
    byKey(items, 'dismiss').onClick();
    byKey(items, 'autoFix').onCheckedChange(false);

    expect(h.onOpenOnGithub).toHaveBeenCalledTimes(1);
    expect(h.onCopyLink).toHaveBeenCalledTimes(1);
    expect(h.onDismiss).toHaveBeenCalledTimes(1);
    expect(h.onToggleAutoFix).toHaveBeenCalledWith(false);
  });

  it('shows the switch as last set, ahead of the server, and keeps the menu open', () => {
    const items = build({
      autoFixChecked: false,
      availability: resolveAutoFixAvailability(autoFix({ enabled: true }), 'tpc-here'),
    });
    expect(byKey(items, 'autoFix')).toMatchObject({
      checked: false,
      closeOnClick: false,
      disabled: false,
      type: 'checkbox',
    });
    expect(byKey(build(), 'autoFix').checked).toBe(true);
  });

  it('greys Auto-fix out without the GitHub App', () => {
    const items = build({ availability: { kind: 'noApp' } });
    expect(byKey(items, 'autoFix')).toMatchObject({
      checked: false,
      desc: 'workingPanel.overview.pr.autoFix.noApp',
      disabled: true,
    });
    expect(byKey(items, 'openOwnerTopic')).toBeUndefined();
  });

  it('greys Auto-fix out when it wakes another topic, and offers to go there', () => {
    const h = handlers();
    const ownerTopic = { agentId: 'agt-2', id: 'tpc-other', title: 'Other' };
    const items = build({
      ...h,
      availability: resolveAutoFixAvailability(
        autoFix({ enabled: true, ownerTopic, ownerTopicId: 'tpc-other' }),
        'tpc-here',
      ),
    });

    // Its own on/off is not this topic's to show or change.
    expect(byKey(items, 'autoFix')).toMatchObject({
      checked: false,
      desc: 'workingPanel.overview.pr.autoFix.otherTopic {"title":"Other"}',
      disabled: true,
    });
    const keys = keysOf(items);
    expect(keys[keys.findIndex((key) => Array.isArray(key)) + 1]).toBe('openOwnerTopic');
    byKey(items, 'openOwnerTopic').onClick();
    expect(h.onOpenOwnerTopic).toHaveBeenCalledWith(ownerTopic);
  });

  it('offers no jump to a topic the viewer cannot open', () => {
    const items = build({ availability: { kind: 'otherTopic', ownerTopic: null } });
    expect(byKey(items, 'openOwnerTopic')).toBeUndefined();
    expect(byKey(items, 'autoFix').disabled).toBe(true);
  });

  it('leaves remove out where the row cannot be removed', () => {
    const items = build({ onDismiss: undefined });
    expect(byKey(items, 'dismiss')).toBeUndefined();
    expect(items.at(-1)).toMatchObject({ key: 'autoFixGroup', type: 'group' });
  });
});

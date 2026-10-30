import { describe, expect, it } from 'vitest';

import { type SidebarAgentItem, type SidebarGroup } from '@/database/repositories/home';

import {
  buildAssigneeAgentSections,
  filterAssigneeSections,
  MAX_RECENT_ASSIGNEES,
  pickRecentAssignees,
  pushRecentAssignee,
  shouldOfferPrivateAgents,
} from './assigneeAgentSections';

const agent = (id: string, extra: Partial<SidebarAgentItem> = {}): SidebarAgentItem => ({
  avatar: null,
  description: null,
  id,
  pinned: false,
  title: id,
  type: 'agent',
  updatedAt: new Date(0),
  ...extra,
});

const group = (id: string, name: string, items: SidebarAgentItem[]): SidebarGroup => ({
  id,
  items,
  name,
  sort: 0,
});

const labels = { pinned: 'Pinned', ungrouped: 'Default List' };

describe('buildAssigneeAgentSections', () => {
  it('mirrors the sidebar: pinned, groups in order, then the rest', () => {
    const sections = buildAssigneeAgentSections({
      groups: [
        group('g-rollout', 'Rollouts', [agent('mh-rollout:run_1'), agent('mh-rollout:run_2')]),
        group('g-empty', 'Empty', []),
        group('g-work', 'Work', [agent('writer')]),
      ],
      labels,
      pinned: [agent('lobo')],
      scope: 'workspace',
      ungrouped: [agent('misc'), agent('chat-group', { type: 'group' })],
    });

    expect(sections.map((s) => [s.title, s.collapsible, s.agents.map((a) => a.id)])).toEqual([
      ['Pinned', false, ['lobo']],
      ['Rollouts', true, ['mh-rollout:run_1', 'mh-rollout:run_2']],
      ['Work', true, ['writer']],
      ['Default List', false, ['misc']],
    ]);
  });

  it('keeps a lone ungrouped list without a header', () => {
    const sections = buildAssigneeAgentSections({
      groups: [],
      labels,
      pinned: [],
      scope: 'private',
      ungrouped: [agent('a')],
    });

    expect(sections).toEqual([
      { agents: [agent('a')], collapsible: false, id: 'private:ungrouped', title: undefined },
    ]);
  });
});

describe('filterAssigneeSections', () => {
  it('matches the description and drops sections left empty', () => {
    const sections = buildAssigneeAgentSections({
      groups: [group('g', 'Rollouts', [agent('mh-rollout:run_1')])],
      labels,
      pinned: [],
      scope: 'workspace',
      ungrouped: [agent('reviewer', { description: 'Reviews pull requests' })],
    });

    const result = filterAssigneeSections(sections, 'pull request');

    expect(result.map((s) => s.agents.map((a) => a.id))).toEqual([['reviewer']]);
  });
});

describe('recent assignees', () => {
  it('resolves stored ids in order and skips agents no longer offered', () => {
    const result = pickRecentAssignees(['b', 'gone', 'a'], [agent('a'), agent('b')]);

    expect(result.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('moves a pick to the front without duplicates and caps the list', () => {
    const full = ['a', 'b', 'c', 'd', 'e'];

    expect(pushRecentAssignee(full, 'c')).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(pushRecentAssignee(full, 'f')).toEqual(['f', 'a', 'b', 'c', 'd']);
    expect(pushRecentAssignee(undefined, 'a')).toEqual(['a']);
    expect(pushRecentAssignee(full, 'f')).toHaveLength(MAX_RECENT_ASSIGNEES);
  });
});

describe('shouldOfferPrivateAgents', () => {
  const creatorOnPublicTask = {
    currentUserId: 'user-a',
    hasOnChange: false,
    taskCreatorId: 'user-a',
    taskIdentifier: 'T-1',
    taskVisibility: 'public' as const,
    workspaceId: 'ws-1',
  };

  it('offers private agents on a non-public task without privatizing it', () => {
    expect(shouldOfferPrivateAgents({ ...creatorOnPublicTask, taskVisibility: 'private' })).toEqual(
      { offer: true, privatizes: false },
    );
    expect(shouldOfferPrivateAgents({ ...creatorOnPublicTask, taskVisibility: null })).toEqual({
      offer: true,
      privatizes: false,
    });
  });

  it('lets the creator of a public workspace task pick a private agent by privatizing it', () => {
    expect(shouldOfferPrivateAgents(creatorOnPublicTask)).toEqual({
      offer: true,
      privatizes: true,
    });
  });

  it('keeps private agents hidden on a public task for everyone else', () => {
    const hidden = { offer: false, privatizes: false };
    expect(shouldOfferPrivateAgents({ ...creatorOnPublicTask, currentUserId: 'user-b' })).toEqual(
      hidden,
    );
    expect(shouldOfferPrivateAgents({ ...creatorOnPublicTask, taskCreatorId: undefined })).toEqual(
      hidden,
    );
    expect(shouldOfferPrivateAgents({ ...creatorOnPublicTask, hasOnChange: true })).toEqual(hidden);
    expect(shouldOfferPrivateAgents({ ...creatorOnPublicTask, taskIdentifier: undefined })).toEqual(
      hidden,
    );
    expect(shouldOfferPrivateAgents({ ...creatorOnPublicTask, workspaceId: null })).toEqual(hidden);
  });
});

import { describe, expect, it } from 'vitest';

import {
  isProjectionFragmentName,
  isProjectionIndexKey,
  isProjectionSnapshotKey,
} from './registry';

describe('Projection runtime registry', () => {
  it.each([
    'agent.available',
    'agent.directory',
    'agent.search:',
    'agent.search:assistant',
    'brief.news:2026-08-12',
    'chat.agentViewTopics:agent-1',
    'chat.sidebarTopics:inbox',
    'chatGroup.list',
    'home.inboxTopics',
    'home.recentTopics',
    'home.scheduledTasks',
    'home.sidebar',
    'home.tasks',
    'home.unresolvedBriefs',
    'task.groupList:__none__:all',
    'task.list:__none__:all',
  ])('accepts the registered Index key %s', (key) => {
    expect(isProjectionIndexKey(key)).toBe(true);
  });

  it.each([
    '',
    'brief.news:',
    'chat.agentViewTopics:',
    'chat.sidebarTopics:',
    'task.groupList:',
    'task.list:',
    'unknown.index',
  ])('rejects the unregistered or incomplete Index key %s', (key) => {
    expect(isProjectionIndexKey(key)).toBe(false);
  });

  it('registers Snapshot and Fragment names at runtime', () => {
    expect(isProjectionSnapshotKey('home.dailyBrief')).toBe(true);
    expect(isProjectionSnapshotKey('home.unknown')).toBe(false);
    expect(isProjectionFragmentName('topic', 'triggerInfo')).toBe(true);
    expect(isProjectionFragmentName('topic', 'unknown')).toBe(false);
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getProjectionStoreState,
  nextProjectionObservedAt,
  selectChatTopicListItem,
  useProjectionStore,
} from '@/projection';
import type { RecentItem } from '@/server/routers/lambda/recent';
import { taskService } from '@/services/task';
import { topicService } from '@/services/topic';

import { persistRecentRename } from './renameRecent';

const SCOPE = 'user-1:personal';

describe('persistRecentRename', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useProjectionStore.setState({ scopes: {} });
  });

  it('re-stamps a Topic title after an in-flight revalidation observed the old value', async () => {
    getProjectionStoreState().commitChatTopicsPage(
      SCOPE,
      {
        containerKey: 'inbox',
        context: { agentId: null },
        items: [
          {
            createdAt: 1,
            favorite: false,
            id: 'topic-1',
            title: 'Original title',
            updatedAt: 1,
            userId: 'user-1',
          },
        ],
        page: 0,
        pageSize: 20,
        signature: {},
        surface: 'sidebar',
        total: 1,
      },
      { observedAt: nextProjectionObservedAt(), source: 'network' },
    );
    vi.spyOn(topicService, 'updateTopic').mockImplementation(async () => {
      getProjectionStoreState().commitChatTopicsPage(
        SCOPE,
        {
          containerKey: 'inbox',
          context: { agentId: null },
          items: [
            {
              createdAt: 1,
              favorite: false,
              id: 'topic-1',
              title: 'Stale revalidation title',
              updatedAt: 1,
              userId: 'user-1',
            },
          ],
          page: 0,
          pageSize: 20,
          signature: {},
          surface: 'sidebar',
          total: 1,
        },
        { observedAt: nextProjectionObservedAt(), source: 'network' },
      );
      return undefined as never;
    });

    await persistRecentRename(
      { id: 'topic-1', type: 'topic' } as RecentItem,
      'Confirmed title',
      SCOPE,
    );

    expect(selectChatTopicListItem(getProjectionStoreState().scopes[SCOPE], 'topic-1')?.title).toBe(
      'Confirmed title',
    );
  });

  it('writes a confirmed Task name to the canonical Projection', async () => {
    getProjectionStoreState().commitTaskList(
      SCOPE,
      [
        {
          id: 'task-1',
          identifier: 'T-1',
          name: 'Original task',
          participants: [],
          status: 'backlog',
        } as never,
      ],
      1,
      { agentKey: '__all__', visibility: 'all' },
      nextProjectionObservedAt(),
    );
    vi.spyOn(taskService, 'update').mockResolvedValue(undefined as never);

    await persistRecentRename(
      { id: 'task-1', type: 'task' } as RecentItem,
      'Confirmed task',
      SCOPE,
    );

    expect(
      getProjectionStoreState().scopes[SCOPE].records.task['task-1'].fragments.display?.data.name,
    ).toBe('Confirmed task');
  });
});

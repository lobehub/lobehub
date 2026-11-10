import { describe, expect, it } from 'vitest';

import { type ChatTopic } from '@/types/topic';

import { groupProjectTopics, UNKNOWN_DEVICE_SUB_GROUP_ID } from './subGroups';

const createTopic = (id: string, overrides: Partial<ChatTopic> = {}): ChatTopic =>
  ({
    createdAt: 0,
    favorite: false,
    id,
    title: id,
    updatedAt: 0,
    ...overrides,
  }) as ChatTopic;

const directoryDevices: Record<string, string> = { 'dir-a': 'mac', 'dir-b': 'linux' };
const resolveDeviceId = (topic: ChatTopic) =>
  (topic.projectWorkingDirectoryId && directoryDevices[topic.projectWorkingDirectoryId]) ||
  topic.metadata?.boundDeviceId;

const ids = (groups: ReturnType<typeof groupProjectTopics>) =>
  groups?.map((group) => [group.id, group.children.map((topic) => topic.id)]);

describe('groupProjectTopics', () => {
  it('keeps the plain list for none', () => {
    expect(
      groupProjectTopics([createTopic('a')], 'none', { field: 'updatedAt', resolveDeviceId }),
    ).toBeUndefined();
  });

  it('sections by device in sidebar order, with unresolved machines last', () => {
    const groups = groupProjectTopics(
      [
        createTopic('t1', { projectWorkingDirectoryId: 'dir-b' }),
        createTopic('t2'),
        createTopic('t3', { projectWorkingDirectoryId: 'dir-a' }),
        createTopic('t4', { metadata: { boundDeviceId: 'linux' } }),
      ],
      'byDevice',
      { field: 'updatedAt', resolveDeviceId },
    );

    expect(ids(groups)).toEqual([
      ['device:linux', ['t1', 't4']],
      ['device:mac', ['t3']],
      [UNKNOWN_DEVICE_SUB_GROUP_ID, ['t2']],
    ]);
  });

  it('lists available devices without topics as empty sections before the unknown one', () => {
    const groups = groupProjectTopics(
      [createTopic('t1', { projectWorkingDirectoryId: 'dir-b' }), createTopic('t2')],
      'byDevice',
      { availableDeviceIds: ['mac', 'linux'], field: 'updatedAt', resolveDeviceId },
    );

    expect(ids(groups)).toEqual([
      ['device:linux', ['t1']],
      ['device:mac', []],
      [UNKNOWN_DEVICE_SUB_GROUP_ID, ['t2']],
    ]);
  });

  it('sections by status, counting client-side streaming as running', () => {
    const groups = groupProjectTopics(
      [
        createTopic('done', { status: 'completed' }),
        createTopic('streaming'),
        createTopic('failed', { status: 'failed' }),
      ],
      'byStatus',
      { field: 'updatedAt', loadingTopicIds: new Set(['streaming']), resolveDeviceId },
    );

    expect(ids(groups)).toEqual([
      ['pending', ['failed']],
      ['running', ['streaming']],
      ['completed', ['done']],
    ]);
  });

  it('sections by time on the configured sort field', () => {
    const now = Date.now();
    const groups = groupProjectTopics(
      [
        createTopic('old-update', { createdAt: now, updatedAt: now - 400 * 86_400_000 }),
        createTopic('fresh-update', { createdAt: now - 400 * 86_400_000, updatedAt: now }),
      ],
      'byTime',
      { field: 'updatedAt', resolveDeviceId },
    );

    expect(groups?.[0]).toMatchObject({ id: 'today' });
    expect(groups?.[0].children.map((topic) => topic.id)).toEqual(['fresh-update']);
  });
});

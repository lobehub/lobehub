import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { topicService } from '@/services/topic';
import { type ChatTopic } from '@/types/topic';

import { useChatStore } from '../../store';

const topic = (path: string) =>
  ({
    id: 'project-topic',
    metadata: { workingDirectory: path, workingDirectoryConfig: { path } },
    projectId: 'project-1',
    title: 'Project topic',
  }) as unknown as ChatTopic;

beforeEach(() => {
  useChatStore.setState({ topicDataMap: {}, topicDetailMap: {} }, false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('topic detail read', () => {
  // Regression: a page reload starts the detail read before the persisted copy
  // hydrates. That copy appearing mid-read was taken for a local edit and the
  // server's answer was dropped, so a conversation moved to another runner kept
  // showing its old folder.
  it('applies the server answer over a copy that hydrated while it was in flight', async () => {
    let resolve!: (value: ChatTopic) => void;
    vi.spyOn(topicService, 'getTopicDetail').mockReturnValue(
      new Promise<ChatTopic>((r) => {
        resolve = r;
      }),
    );

    const read = useChatStore.getState().refreshTopicDetail('project-topic', true);
    useChatStore.setState({ topicDetailMap: { 'project-topic': topic('/tmp/a') } }, false);
    resolve(topic('/tmp/b'));
    await read;

    await waitFor(() => {
      expect(
        useChatStore.getState().topicDetailMap['project-topic']?.metadata?.workingDirectoryConfig,
      ).toEqual({ path: '/tmp/b' });
    });
  });
});

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceHtmlArtifactPublish } from '../WorkspaceHtmlArtifactPublish';

const listByTopicQuery = vi.fn();
const publishArtifactMutate = vi.fn();
const createMessage = vi.fn();

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      deployments: {
        listByTopic: { query: (...args: unknown[]) => listByTopicQuery(...args) },
        publishArtifact: { mutate: (...args: unknown[]) => publishArtifactMutate(...args) },
        publishWorkspaceHtml: { mutate: vi.fn() },
      },
    },
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    createMessage: (...args: unknown[]) => createMessage(...args),
  },
}));

describe('useWorkspaceHtmlArtifactPublish', () => {
  beforeEach(() => {
    listByTopicQuery.mockReset();
    publishArtifactMutate.mockReset();
    createMessage.mockReset();
  });

  it('is available and returns an existing deployment for the same identifier', async () => {
    listByTopicQuery.mockResolvedValue({
      data: [
        {
          artifactIdentifier: 'workspace-html-index-html',
          latestRevisionNumber: 3,
          publicUrl: 'https://example.lobehub.com/page',
          status: 'active',
        },
      ],
    });

    const { result } = renderHook(() => useWorkspaceHtmlArtifactPublish());

    expect(result.current.available).toBe(true);
    await expect(
      result.current.getExisting({ identifier: 'workspace-html-index-html', topicId: 'tpc_1' }),
    ).resolves.toEqual({
      identifier: 'workspace-html-index-html',
      publicUrl: 'https://example.lobehub.com/page',
      revision: 3,
      status: 'active',
    });
  });

  it('treats a missing market procedure as no existing project', async () => {
    listByTopicQuery.mockRejectedValue(new Error('NOT_FOUND'));

    const { result } = renderHook(() => useWorkspaceHtmlArtifactPublish());

    await expect(
      result.current.getExisting({ identifier: 'workspace-html-index-html', topicId: 'tpc_1' }),
    ).resolves.toBeNull();
  });

  it('persists a packed artifact message then publishes it', async () => {
    createMessage.mockResolvedValue({ id: 'msg_1', messages: [] });
    publishArtifactMutate.mockResolvedValue({
      data: { latestRevisionNumber: 1, publicUrl: 'https://example.lobehub.com/page' },
    });

    const { result } = renderHook(() => useWorkspaceHtmlArtifactPublish());
    const published = await result.current.publish({
      agentId: 'agt_1',
      entryPath: 'index.html',
      files: [
        {
          content: '<html><title>Demo</title></html>',
          contentType: 'text/html',
          encoding: 'utf8',
          path: 'index.html',
        },
      ],
      identifier: 'workspace-html-index-html',
      title: 'Demo',
      topicId: 'tpc_1',
    });

    expect(published).toEqual({
      publicUrl: 'https://example.lobehub.com/page',
      revision: 1,
    });
    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agt_1',
        role: 'assistant',
        topicId: 'tpc_1',
      }),
    );
    expect(publishArtifactMutate).toHaveBeenCalledWith({
      artifactIdentifier: 'workspace-html-index-html',
      messageId: 'msg_1',
      requestedSlug: 'Demo',
      topicId: 'tpc_1',
    });
  });
});

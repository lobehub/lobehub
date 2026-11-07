import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTopicCommentDraftKey, topicCommentSelectors, useTopicCommentStore } from '.';

describe('topicCommentStore', () => {
  beforeEach(() => {
    useTopicCommentStore.getState().reset();
  });

  it('scopes drafts by workspace, topic and target', () => {
    const messageKey = createTopicCommentDraftKey({
      messageId: 'message-1',
      topicId: 'topic-1',
      workspaceId: 'workspace-1',
    });
    const replyKey = createTopicCommentDraftKey({
      parentCommentId: 'comment-1',
      topicId: 'topic-1',
      workspaceId: 'workspace-1',
    });
    const { result } = renderHook(() => useTopicCommentStore());

    act(() => {
      result.current.setDraft(messageKey, { clientId: 'retry-id', content: 'Message draft' });
      result.current.setDraft(replyKey, { content: 'Reply draft' });
    });

    expect(topicCommentSelectors.draft(messageKey)(result.current)).toEqual({
      clientId: 'retry-id',
      content: 'Message draft',
    });
    expect(topicCommentSelectors.draft(replyKey)(result.current)).toEqual({
      content: 'Reply draft',
    });
  });

  it('clears only the submitted draft and preserves its retry client id until then', () => {
    const firstKey = 'workspace-1:topic-1:message:all';
    const secondKey = 'workspace-1:topic-2:message:all';
    const { result } = renderHook(() => useTopicCommentStore());

    act(() => {
      result.current.setDraft(firstKey, { clientId: 'retry-id', content: 'First' });
      result.current.setDraft(secondKey, { content: 'Second' });
      result.current.clearDraft(firstKey);
    });

    expect(result.current.drafts[firstKey]).toBeUndefined();
    expect(result.current.drafts[secondKey]).toEqual({ content: 'Second' });
  });

  it('preserves new input when an older in-flight submission succeeds', () => {
    const key = 'workspace-1:topic-1:message:all';
    const { result } = renderHook(() => useTopicCommentStore());

    act(() => {
      result.current.setDraft(key, { clientId: 'submitted-id', content: 'Submitted' });
      result.current.setDraftContent(key, 'Next comment');
      result.current.clearDraft(key, 'submitted-id');
    });

    expect(result.current.drafts[key]).toEqual({ clientId: undefined, content: 'Next comment' });
  });

  it('reuses a client id only while retrying the same content', () => {
    const key = 'workspace-1:topic-1:message:all';
    const { result } = renderHook(() => useTopicCommentStore());

    act(() => {
      result.current.setDraft(key, { clientId: 'retry-id', content: 'Submitted' });
      result.current.setDraftContent(key, 'Submitted  ');
    });
    expect(result.current.drafts[key]).toEqual({
      clientId: 'retry-id',
      content: 'Submitted  ',
    });

    act(() => {
      result.current.setDraftContent(key, 'Changed');
    });
    expect(result.current.drafts[key]).toEqual({ clientId: undefined, content: 'Changed' });
  });

  it('keeps editor data with a draft so member mentions survive retries', () => {
    const key = 'workspace-1:topic-1:message:all';
    const editorData = {
      root: {
        children: [{ metadata: { id: 'member-1', type: 'member' }, type: 'mention' }],
      },
    };
    const { result } = renderHook(() => useTopicCommentStore());

    act(() => {
      result.current.setDraft(key, {
        clientId: 'retry-id',
        content: '<mention name="Member" id="member-1" />',
        editorData,
      });
      result.current.setDraftContent(key, '<mention name="Member" id="member-1" />', editorData);
    });

    expect(result.current.drafts[key]).toEqual({
      clientId: 'retry-id',
      content: '<mention name="Member" id="member-1" />',
      editorData,
    });
  });

  it('tracks reply-count operations independently and scopes them to their topic and root', () => {
    const { result } = renderHook(() => useTopicCommentStore());

    act(() => {
      result.current.upsertOptimisticReplyCountMutation({
        baselineCount: 2,
        delta: 1,
        id: 'create:reply-1',
        pending: true,
        rootCommentId: 'root-1',
        topicId: 'topic-1',
        workspaceId: 'workspace-1',
      });
      result.current.upsertOptimisticReplyCountMutation({
        baselineCount: 1,
        delta: -1,
        id: 'delete:reply-2',
        pending: false,
        rootCommentId: 'root-2',
        topicId: 'topic-1',
        workspaceId: 'workspace-1',
      });
    });

    expect(topicCommentSelectors.optimisticReplyCountMutations('root-1')(result.current)).toEqual([
      expect.objectContaining({ delta: 1, id: 'create:reply-1' }),
    ]);
    expect(
      topicCommentSelectors.optimisticReplyCountMutationsByTopic(
        'workspace-1',
        'topic-1',
      )(result.current),
    ).toHaveLength(2);

    act(() => result.current.removeOptimisticReplyCountMutation('create:reply-1'));

    expect(topicCommentSelectors.optimisticReplyCountMutations('root-1')(result.current)).toEqual(
      [],
    );
    expect(result.current.optimisticReplyCountMutations['delete:reply-2']).toBeDefined();
  });
});

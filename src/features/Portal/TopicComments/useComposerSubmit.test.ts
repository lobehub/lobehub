/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { RefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TopicCommentEditorRef } from './TopicCommentEditor';
import { useComposerSubmit } from './useComposerSubmit';

const mocks = vi.hoisted(() => ({
  clean: vi.fn(),
  clearDraft: vi.fn(),
  create: vi.fn(),
  focus: vi.fn(),
  getValue: vi.fn(),
  onCreated: vi.fn(),
  onError: vi.fn(),
  setDraft: vi.fn(),
  setValue: vi.fn(),
  shouldSendOnEnter: vi.fn(),
}));

const editorRef = {
  current: {
    clean: mocks.clean,
    focus: mocks.focus,
    getValue: mocks.getValue,
    setValue: mocks.setValue,
  },
} as RefObject<TopicCommentEditorRef>;

const renderSubmitHook = () =>
  renderHook(() =>
    useComposerSubmit({
      clearDraft: mocks.clearDraft,
      content: 'New topic comment',
      create: mocks.create,
      creating: false,
      draft: { clientId: 'client-1', content: 'New topic comment' },
      editorRef,
      key: 'draft-key',
      onCreated: mocks.onCreated,
      onError: mocks.onError,
      setDraft: mocks.setDraft,
      shouldSendOnEnter: mocks.shouldSendOnEnter,
      topicId: 'topic-1',
    }),
  );

describe('useComposerSubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ comment: { id: 'comment-1' }, isDuplicate: false });
    mocks.getValue.mockReturnValue({
      content: 'New topic comment',
      editorData: { root: { children: [] } },
    });
    mocks.shouldSendOnEnter.mockReturnValue(true);
  });

  it('clears the submitted draft immediately and reports success after create resolves', async () => {
    let resolveCreate: (() => void) | undefined;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = () => resolve({ comment: { id: 'comment-1' }, isDuplicate: false });
        }),
    );
    const { result } = renderSubmitHook();
    let submission: Promise<void>;

    act(() => {
      submission = result.current.submit();
    });

    expect(mocks.clearDraft).toHaveBeenCalledWith('draft-key', 'client-1');
    expect(mocks.clean).toHaveBeenCalledOnce();
    expect(result.current.submitting).toBe(true);
    expect(mocks.onCreated).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate?.();
      await submission!;
    });

    expect(result.current.submitting).toBe(false);
    expect(mocks.onCreated).toHaveBeenCalledOnce();
  });

  it('restores the submitted draft and editor when create fails', async () => {
    mocks.create.mockRejectedValueOnce(new Error('network failed'));
    const { result } = renderSubmitHook();

    await act(async () => {
      await result.current.submit();
    });

    const expectedValue = {
      content: 'New topic comment',
      editorData: { root: { children: [] } },
    };
    expect(mocks.setDraft).toHaveBeenLastCalledWith('draft-key', {
      clientId: 'client-1',
      ...expectedValue,
    });
    expect(mocks.setValue).toHaveBeenCalledWith(expectedValue);
    expect(mocks.focus).toHaveBeenCalledOnce();
    expect(mocks.onError).toHaveBeenCalledOnce();
  });

  it('submits member mention editor data with the comment markdown', async () => {
    const editorData = {
      root: {
        children: [
          {
            label: 'Workspace Member',
            metadata: { id: 'member-1', type: 'member' },
            type: 'mention',
          },
        ],
      },
    };
    mocks.getValue.mockReturnValueOnce({
      content: 'Hello <mention name="Workspace Member" id="member-1" />',
      editorData,
    });
    const { result } = renderSubmitHook();

    await act(async () => {
      await result.current.submit();
    });

    expect(mocks.create).toHaveBeenCalledWith(
      {
        clientId: 'client-1',
        content: 'Hello <mention name="Workspace Member" id="member-1" />',
        editorData,
        messageId: undefined,
        parentCommentId: undefined,
        topicId: 'topic-1',
      },
      { rootReplyCount: undefined },
    );
  });

  it('ignores a second submit before the creating state rerenders', async () => {
    let resolveCreate: (() => void) | undefined;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = () => resolve({ comment: { id: 'comment-1' }, isDuplicate: false });
        }),
    );
    const { result } = renderSubmitHook();

    act(() => {
      void result.current.submit();
      void result.current.submit();
    });

    expect(mocks.create).toHaveBeenCalledOnce();
    await act(async () => resolveCreate?.());
  });

  it('uses the shared enter-to-send preference', async () => {
    const { result } = renderSubmitHook();
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    mocks.shouldSendOnEnter.mockReturnValueOnce(false);
    expect(result.current.onPressEnter(event)).toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();

    expect(result.current.onPressEnter(event)).toBe(true);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.shouldSendOnEnter).toHaveBeenCalledTimes(2);
  });
});

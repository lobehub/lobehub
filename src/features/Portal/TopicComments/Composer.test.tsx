/**
 * @vitest-environment happy-dom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as ReactType from 'react';
import type { ReactNode, Ref } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Body from './Body';
import Composer from './Composer';
import ThreadBody from './ThreadBody';

const mocks = vi.hoisted(() => ({
  clearDraft: vi.fn(),
  create: vi.fn(),
  draft: { clientId: 'client-1', content: 'New topic comment' } as
    { clientId?: string; content: string; editorData?: unknown } | undefined,
  messageError: vi.fn(),
  openTopicCommentThread: vi.fn(),
  repliesLoading: false,
  reloadThreads: vi.fn(),
  rootData: undefined as { content: string; id: string } | undefined,
  rootError: undefined as unknown,
  rootLoading: false,
  setDraft: vi.fn(),
  setDraftContent: vi.fn(),
  shouldSendOnEnter: vi.fn(),
}));

vi.mock('@lobehub/editor/react', () => ({
  ChatInput: ({ children, footer }: { children: ReactNode; footer?: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
  ChatInputActionBar: ({ justify, right }: { justify?: string; right?: ReactNode }) => (
    <div data-justify={justify} data-testid="comment-action-bar">
      {right}
    </div>
  ),
  SendButton: ({
    disabled,
    loading,
    onClick,
  }: {
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
  }) => (
    <button data-loading={loading} disabled={disabled} type="button" onClick={onClick}>
      Send
    </button>
  ),
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
  Flexbox: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: mocks.messageError } }) },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'workspace-1',
}));

vi.mock('@/business/client/hooks/useIsWorkspaceViewer', () => ({
  useIsWorkspaceViewer: () => false,
}));

vi.mock('@/features/TopicComment/hooks', () => ({
  useTopicCommentDetail: (_id: string, fallbackData?: { content: string; id: string }) => ({
    data: mocks.rootData ?? fallbackData,
    error: mocks.rootError,
    isLoading: mocks.rootLoading,
    mutate: vi.fn(),
  }),
  useTopicCommentReplies: () => ({
    error: undefined,
    hasMore: false,
    isLoadingInitial: mocks.repliesLoading,
    items: [],
    pendingCommentIds: new Set(),
  }),
  useTopicCommentReplyCount: (_id: string, count: number) => count,
  useTopicCommentMutations: () => ({ create: mocks.create, creating: false }),
  useTopicCommentThreads: () => ({
    error: undefined,
    hasMore: false,
    isInitialError: false,
    isLoadingInitial: false,
    isLoadingMore: false,
    isRetrying: false,
    items: [
      {
        replyCount: 0,
        root: { content: 'Existing topic comment', id: 'comment-1' },
      },
    ],
    loadMore: vi.fn(),
    pendingCommentIds: new Set(),
    reload: mocks.reloadThreads,
  }),
}));

vi.mock('@/hooks/useEnterToSend', () => ({
  useEnterToSend: () => mocks.shouldSendOnEnter,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<PropertyKey, unknown>) => unknown) =>
    selector({
      openTopicCommentThread: mocks.openTopicCommentThread,
      popPortalView: vi.fn(),
      threadView: {
        initialReplyCount: 2,
        initialRoot: { content: 'Existing topic comment', id: 'comment-1' },
        rootCommentId: 'comment-1',
        topicId: 'topic-1',
      },
      view: { topicId: 'topic-1' },
    }),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    topicCommentThreadView: (state: { threadView: { rootCommentId: string; topicId: string } }) =>
      state.threadView,
    topicCommentsView: (state: { view: { topicId: string } }) => state.view,
  },
}));

vi.mock('@/store/topicComment', () => ({
  createTopicCommentDraftKey: () => 'draft-key',
  topicCommentSelectors: { draft: () => () => mocks.draft },
  useTopicCommentStore: (selector: (state: Record<PropertyKey, unknown>) => unknown) =>
    selector({
      clearDraft: mocks.clearDraft,
      setDraft: mocks.setDraft,
      setDraftContent: mocks.setDraftContent,
    }),
}));

vi.mock('./TopicCommentEditor', async () => {
  const React = await vi.importActual<typeof ReactType>('react');
  const MockTopicCommentEditor = ({
    ref,
    disabled,
    onChange,
    onPressEnter,
  }: {
    disabled?: boolean;
    onChange?: (value: { content: string; editorData: unknown }) => void;
    onPressEnter?: (event: KeyboardEvent) => boolean | void;
    ref?: Ref<{
      clean: () => void;
      focus: () => void;
      getValue: () => { content: string; editorData: unknown };
      setValue: (value: { content: string; editorData: unknown }) => void;
    }>;
  }) => {
    React.useImperativeHandle(ref, () => ({
      clean: vi.fn(),
      focus: vi.fn(),
      getValue: () => ({
        content: mocks.draft?.content ?? '',
        editorData: mocks.draft?.editorData ?? { root: { children: [] } },
      }),
      setValue: vi.fn(),
    }));

    return (
      <textarea
        disabled={disabled}
        value={mocks.draft?.content ?? ''}
        onChange={(event) =>
          onChange?.({
            content: event.target.value,
            editorData: { root: { children: [] } },
          })
        }
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          if (onPressEnter?.(event.nativeEvent)) event.preventDefault();
        }}
      />
    );
  };

  return { default: MockTopicCommentEditor };
});

vi.mock('@/components/AsyncError', () => ({ default: () => <div>Async error</div> }));

vi.mock('@/components/Loading/BrandTextLoading', () => ({ default: () => <div>Loading</div> }));

vi.mock('./CommentCard', () => ({
  default: ({
    comment,
    onOpenThread,
  }: {
    comment: { content: string };
    onOpenThread?: () => void;
  }) => (
    <article>
      {onOpenThread ? (
        <button type="button" onClick={onOpenThread}>
          {comment.content}
        </button>
      ) : (
        comment.content
      )}
    </article>
  ),
}));

vi.mock('./styles', () => ({
  styles: {
    body: 'body',
    composer: 'composer',
    composerTextarea: 'composerTextarea',
    list: 'list',
  },
}));

describe('TopicCommentComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.draft = { clientId: 'client-1', content: 'New topic comment' };
    mocks.clearDraft.mockImplementation(() => {
      mocks.draft = undefined;
    });
    mocks.setDraft.mockImplementation((_key, draft) => {
      mocks.draft = draft;
    });
    mocks.create.mockResolvedValue({ comment: { id: 'comment-1' }, isDuplicate: false });
    mocks.rootError = undefined;
    mocks.repliesLoading = false;
    mocks.rootData = undefined;
    mocks.rootLoading = false;
    mocks.shouldSendOnEnter.mockReturnValue(true);
  });

  it('clears the submitted draft immediately and keeps it empty after create succeeds', async () => {
    let resolveCreate: (() => void) | undefined;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = () => resolve({ comment: { id: 'comment-1' }, isDuplicate: false });
        }),
    );
    const onCreated = vi.fn();
    render(<Composer topicId="topic-1" onCreated={onCreated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(mocks.clearDraft).toHaveBeenCalledOnce();
    expect(mocks.clearDraft).toHaveBeenCalledWith('draft-key', 'client-1');
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('data-loading', 'true');
    expect(onCreated).not.toHaveBeenCalled();

    await act(async () => resolveCreate?.());

    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it('restores the submitted draft and retry id when an optimistic create is rolled back', async () => {
    let rejectCreate: ((reason: unknown) => void) | undefined;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectCreate = reject;
        }),
    );
    render(<Composer topicId="topic-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));

    await act(async () => rejectCreate?.(new Error('network failed')));

    await waitFor(() => expect(mocks.messageError).toHaveBeenCalledOnce());
    expect(screen.getByRole('textbox')).toHaveValue('New topic comment');
    expect(screen.getByRole('textbox')).not.toBeDisabled();
    expect(mocks.setDraft).toHaveBeenLastCalledWith('draft-key', {
      clientId: 'client-1',
      content: 'New topic comment',
      editorData: { root: { children: [] } },
    });
  });

  it('submits the standard member mention editor data with the comment markdown', async () => {
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
    mocks.draft = {
      clientId: 'client-mention',
      content: 'Hello <mention name="Workspace Member" id="member-1" />',
      editorData,
    };
    render(<Composer topicId="topic-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        {
          clientId: 'client-mention',
          content: 'Hello <mention name="Workspace Member" id="member-1" />',
          editorData,
          messageId: undefined,
          parentCommentId: undefined,
          topicId: 'topic-1',
        },
        { rootReplyCount: undefined },
      ),
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
    render(<Composer topicId="topic-1" />);

    const send = screen.getByRole('button', { name: 'Send' });
    fireEvent.click(send);
    fireEvent.click(send);

    expect(mocks.create).toHaveBeenCalledOnce();

    await act(async () => resolveCreate?.());
  });

  it('uses the shared enter-to-send preference', async () => {
    render(<Composer topicId="topic-1" />);

    mocks.shouldSendOnEnter.mockReturnValueOnce(false);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(mocks.create).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.shouldSendOnEnter).toHaveBeenCalledTimes(2);
  });

  it('aligns the send-only action bar to the right', () => {
    render(<Composer topicId="topic-1" />);

    expect(screen.getByTestId('comment-action-bar')).toHaveAttribute('data-justify', 'flex-end');
  });

  it('keeps the scrollable comments above the bottom composer', () => {
    render(<Body />);

    const comment = screen.getByText('Existing topic comment');
    const textbox = screen.getByRole('textbox');
    const list = comment.closest('.list');

    expect(list).not.toBeNull();
    expect(list?.contains(textbox)).toBe(false);
    expect(list?.nextElementSibling?.contains(textbox)).toBe(true);
  });

  it('passes the existing root and reply count into the thread view snapshot', () => {
    render(<Body />);

    fireEvent.click(screen.getByRole('button', { name: 'Existing topic comment' }));

    expect(mocks.openTopicCommentThread).toHaveBeenCalledWith(
      'topic-1',
      'comment-1',
      { content: 'Existing topic comment', id: 'comment-1' },
      0,
    );
  });

  it('shows a not-found state when a deleted thread root is garbage-collected', () => {
    mocks.rootError = { data: { code: 'NOT_FOUND' } };

    render(<ThreadBody />);

    expect(screen.getByText('topicComment.notFound')).toBeInTheDocument();
    expect(screen.queryByText('Async error')).not.toBeInTheDocument();
  });

  it('renders the snapshotted root and composer while replies load in the background', () => {
    mocks.repliesLoading = true;
    mocks.rootLoading = true;

    render(<ThreadBody />);

    expect(screen.getByText('Existing topic comment')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByText('Loading')).not.toBeInTheDocument();
  });
});

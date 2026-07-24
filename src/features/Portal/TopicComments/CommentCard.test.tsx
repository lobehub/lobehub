/**
 * @vitest-environment happy-dom
 */
import type { TopicCommentItem } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as ReactType from 'react';
import type { ReactNode, Ref } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CommentCard from './CommentCard';

const mocks = vi.hoisted(() => ({
  editorValue: {
    content: 'Hello <mention name="Member" id="member-1" />',
    editorData: {
      root: {
        children: [
          {
            label: 'Member',
            metadata: { id: 'member-1', type: 'member' },
            type: 'mention',
          },
        ],
      },
    },
  },
  messageError: vi.fn(),
  renderedEditorState: undefined as unknown,
  update: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => <span>More</span>,
  Avatar: () => <span>Avatar</span>,
  Flexbox: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Icon: () => null,
  Markdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {children}
    </button>
  ),
  confirmModal: vi.fn(),
  DropdownMenu: ({
    children,
    items,
  }: {
    children?: ReactNode;
    items: Array<{ key: string; label: ReactNode; onClick?: () => void }>;
  }) => (
    <div>
      {children}
      {items.map((item) => (
        <button key={item.key} type="button" onClick={item.onClick}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: mocks.messageError } }) },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/TopicComment/hooks', () => ({
  useTopicCommentMutations: () => ({
    mutatingIds: new Set(),
    remove: vi.fn(),
    restore: vi.fn(),
    update: mocks.update,
  }),
}));

vi.mock('@/features/Conversation/Messages/User/components/RichTextMessage', () => ({
  default: ({ editorState }: { editorState: unknown }) => {
    mocks.renderedEditorState = editorState;
    return <div>Rich mention content</div>;
  },
}));

vi.mock('@/hooks/useActivityTime', () => ({
  useActivityTime: () => ({ text: 'now', title: 'now' }),
}));

vi.mock('./AnchorPreview', () => ({ default: () => null }));

vi.mock('./TopicCommentEditor', async () => {
  const React = await vi.importActual<typeof ReactType>('react');
  const MockTopicCommentEditor = ({
    ref,
    initialContent,
  }: {
    initialContent: string;
    ref?: Ref<{
      getValue: () => typeof mocks.editorValue;
    }>;
  }) => {
    React.useImperativeHandle(ref, () => ({ getValue: () => mocks.editorValue }));
    return <textarea readOnly value={initialContent} />;
  };

  return { default: MockTopicCommentEditor };
});

vi.mock('./styles', () => ({
  styles: {
    card: 'card',
    cardActions: 'cardActions',
    deleted: 'deleted',
    editEditor: 'editEditor',
    edited: 'edited',
    moderatedContent: 'moderatedContent',
    reply: 'reply',
  },
}));

const comment: TopicCommentItem = {
  anchorPreview: null,
  author: {
    avatar: null,
    fullName: 'Author',
    id: 'author-1',
    status: 'active',
    username: 'author',
  },
  authorUserId: 'author-1',
  canDelete: true,
  canEdit: true,
  canRestore: false,
  clientId: 'client-1',
  content: 'Original comment',
  createdAt: new Date('2026-07-22T00:00:00.000Z'),
  deletedAt: null,
  editorData: null,
  id: 'comment-1',
  messageId: null,
  moderatedAt: null,
  moderationExpiresAt: null,
  moderationIsOwn: false,
  parentCommentId: null,
  topicId: 'topic-1',
  updatedAt: new Date('2026-07-22T00:00:00.000Z'),
  workspaceId: 'workspace-1',
};

describe('TopicCommentCard editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.renderedEditorState = undefined;
    mocks.update.mockResolvedValue({ ...comment, ...mocks.editorValue });
  });

  it('renders persisted mention editor data with the existing rich-text renderer', () => {
    render(
      <CommentCard
        comment={{
          ...comment,
          content: mocks.editorValue.content,
          editorData: mocks.editorValue.editorData,
        }}
      />,
    );

    expect(screen.getByText('Rich mention content')).toBeInTheDocument();
    expect(mocks.renderedEditorState).toBe(mocks.editorValue.editorData);
    expect(screen.queryByText(mocks.editorValue.content)).not.toBeInTheDocument();
  });

  it('updates a comment with its member mention editor data', async () => {
    render(<CommentCard comment={comment} />);

    fireEvent.click(screen.getByRole('button', { name: 'topicComment.edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'topicComment.save' }));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        {
          content: 'Hello <mention name="Member" id="member-1" />',
          editorData: mocks.editorValue.editorData,
          id: 'comment-1',
        },
        comment,
      ),
    );
  });
});

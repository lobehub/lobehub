/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TopicCommentEditor, { type TopicCommentEditorRef } from './TopicCommentEditor';

const mocks = vi.hoisted(() => {
  const documents = {
    json: { root: { children: [] } } as unknown,
    markdown: 'Draft comment',
  };
  const editor = {
    cleanDocument: vi.fn(),
    dispatchCommand: vi.fn(),
    focus: vi.fn(),
    getDocument: vi.fn((type: 'json' | 'markdown') => documents[type]),
    setDocument: vi.fn(),
  };

  return {
    documents,
    editor,
    editorProps: undefined as
      | {
          content: unknown;
          mentionOption: {
            items: Array<{
              key: string;
              label: string;
              metadata: Record<string, unknown>;
            }>;
            markdownWriter: (mention: {
              label?: string;
              metadata?: Record<string, unknown>;
            }) => string;
            onSelect: (editor: unknown, option: unknown) => void;
          };
          onTextChange: (editor: unknown) => void;
          type: string;
        }
      | undefined,
    insertMentionCommand: Symbol('insert-mention'),
    members: [
      {
        user: {
          avatar: 'avatar.png',
          email: 'alice@example.com',
          fullName: 'Alice',
          username: 'alice',
        },
        userId: 'user-alice',
      },
      {
        user: {
          avatar: null,
          email: 'bob@example.com',
          fullName: null,
          username: 'bob',
        },
        userId: 'user-bob',
      },
      { userId: 'user-alice' },
    ],
  };
});

vi.mock('@lobehub/editor', () => ({
  INSERT_MENTION_COMMAND: mocks.insertMentionCommand,
}));

vi.mock('@lobehub/editor/react', () => ({
  Editor: (props: NonNullable<typeof mocks.editorProps>) => {
    mocks.editorProps = props;
    return <div data-testid="topic-comment-editor" />;
  },
  useEditor: () => mocks.editor,
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar }: { avatar?: string }) => <span>{avatar}</span>,
}));

vi.mock('@/business/client/hooks/useWorkspaceMembers', () => ({
  useWorkspaceMembers: () => mocks.members,
}));

describe('TopicCommentEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.editorProps = undefined;
    mocks.documents.json = { root: { children: [] } };
    mocks.documents.markdown = 'Draft comment';
  });

  it('initializes an empty composer without using the markdown data source', () => {
    render(<TopicCommentEditor initialContent="" placeholder="Comment" />);

    expect(mocks.editorProps).toMatchObject({ content: '', type: 'text' });
  });

  it('reuses the editor mention node with active workspace member metadata', () => {
    render(<TopicCommentEditor initialContent="" placeholder="Comment" />);

    expect(mocks.editorProps?.mentionOption.items).toHaveLength(2);
    expect(mocks.editorProps?.mentionOption.items[0]).toMatchObject({
      key: 'member-user-alice',
      label: 'Alice',
      metadata: {
        description: 'alice@example.com',
        id: 'user-alice',
        timestamp: 0,
        type: 'member',
      },
    });

    const alice = mocks.editorProps!.mentionOption.items[0];
    act(() => mocks.editorProps!.mentionOption.onSelect(mocks.editor, alice));

    expect(mocks.editor.dispatchCommand).toHaveBeenCalledWith(mocks.insertMentionCommand, {
      label: 'Alice',
      metadata: alice.metadata,
    });
    expect(
      mocks.editorProps!.mentionOption.markdownWriter({
        label: 'Alice',
        metadata: alice.metadata,
      }),
    ).toBe('<mention name="Alice" id="user-alice" />');
  });

  it('hydrates editor JSON and exposes markdown plus JSON to create and edit flows', () => {
    const initialEditorData = {
      root: {
        children: [
          {
            label: 'Alice',
            metadata: { id: 'user-alice', type: 'member' },
            type: 'mention',
          },
        ],
      },
    };
    const editorRef = { current: null as TopicCommentEditorRef | null };
    const onChange = vi.fn();

    render(
      <TopicCommentEditor
        initialContent="ignored markdown"
        initialEditorData={initialEditorData}
        placeholder="Comment"
        ref={(instance) => {
          editorRef.current = instance;
        }}
        onChange={onChange}
      />,
    );

    expect(mocks.editorProps).toMatchObject({ content: initialEditorData, type: 'json' });
    expect(editorRef.current?.getValue()).toEqual({
      content: 'Draft comment',
      editorData: { root: { children: [] } },
    });

    act(() => mocks.editorProps!.onTextChange(mocks.editor));
    expect(onChange).toHaveBeenCalledWith({
      content: 'Draft comment',
      editorData: { root: { children: [] } },
    });

    act(() => {
      editorRef.current?.setValue({ content: 'Restored', editorData: initialEditorData });
      editorRef.current?.clean();
      editorRef.current?.focus();
    });
    expect(mocks.editor.setDocument).toHaveBeenCalledWith('json', initialEditorData);
    expect(mocks.editor.cleanDocument).toHaveBeenCalledOnce();
    expect(mocks.editor.focus).toHaveBeenCalledOnce();
  });
});

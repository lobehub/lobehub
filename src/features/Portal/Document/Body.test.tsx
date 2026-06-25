import { act, fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DocumentBody from './Body';

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    content: 'content',
  }),
  cssVar: {
    colorBgContainer: 'var(--color-bg-container)',
    colorBorderSecondary: 'var(--color-border-secondary)',
    colorTextSecondary: 'var(--color-text-secondary)',
    fontFamilyCode: 'monospace',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: () => null,
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TextArea: () => <textarea />,
}));

vi.mock('@/components/CodeEditorPane', () => ({
  default: ({
    onChange,
    onSave,
    value,
  }: {
    onChange?: (next: string) => void;
    onSave?: () => void;
    value: string;
  }) => (
    <textarea
      data-testid="highlight-editor"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 's') {
          event.preventDefault();
          onSave?.();
        }
      }}
    />
  ),
}));

const mockDocumentMeta = vi.hoisted(() => ({
  current: { content: '', filename: 'doc.md' } as {
    content?: string;
    fileType?: string | null;
    filename?: string | null;
    title?: string | null;
  },
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({ data: mockDocumentMeta.current }),
}));

const mockUpdateDocument = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/services/document', () => ({
  documentService: {
    getDocumentById: vi.fn(),
    updateDocument: mockUpdateDocument,
  },
}));

vi.mock('./EditorCanvas', () => ({
  default: () => <div data-testid="editor-canvas" />,
}));

vi.mock('./TodoList', () => ({
  default: () => <div data-testid="todo-list" />,
}));

vi.mock('@/features/FloatingChatPanel', () => ({
  default: () => <div data-testid="floating-chat-panel" />,
}));

const docChatTopicState = vi.hoisted(() => ({
  current: {
    error: undefined as Error | undefined,
    isLoading: false,
    topicId: 'doc-topic-1' as string | undefined,
  },
}));
vi.mock('@/features/FloatingChatPanel/useDocumentChatTopic', () => ({
  useDocumentChatTopic: () => docChatTopicState.current,
}));

const mockChatState = vi.hoisted(() => ({
  current: {
    activeTopicId: 'topic-1',
    portalStack: [
      {
        agentDocumentId: 'agent-document-1',
        documentId: 'document-1',
        type: 'document',
      },
    ],
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) => selector(mockChatState.current),
}));

const mockAgentState = vi.hoisted(() => ({
  current: {
    activeAgentId: 'agent-1',
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) => selector(mockAgentState.current),
}));

const mockDocumentState = vi.hoisted(() => ({
  current: {
    documents: {
      'document-1': {},
    },
    performSave: vi.fn(),
    updateSkillFrontmatter: vi.fn(),
  },
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: (selector: any) => selector(mockDocumentState.current),
}));

const mockUserState = vi.hoisted(() => ({
  current: {
    preference: {
      lab: {
        enableAgentDocumentFloatingChatPanel: false,
      },
    },
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector(mockUserState.current),
}));

describe('DocumentBody', () => {
  beforeEach(() => {
    mockAgentState.current.activeAgentId = 'agent-1';
    mockUserState.current.preference.lab.enableAgentDocumentFloatingChatPanel = false;
    mockDocumentMeta.current = { content: '', filename: 'doc.md' };
    mockUpdateDocument.mockClear();
    docChatTopicState.current = {
      error: undefined,
      isLoading: false,
      topicId: 'doc-topic-1',
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render FloatingChatPanel when the lab feature is disabled', () => {
    render(<DocumentBody />);

    expect(screen.queryByTestId('floating-chat-panel')).toBeNull();
  });

  it('renders FloatingChatPanel when the lab feature is enabled and the doc topic resolves', () => {
    mockUserState.current.preference.lab.enableAgentDocumentFloatingChatPanel = true;

    render(<DocumentBody />);

    expect(screen.getByTestId('floating-chat-panel')).toBeDefined();
  });

  it('holds the panel until the doc-anchored topic id resolves', () => {
    mockUserState.current.preference.lab.enableAgentDocumentFloatingChatPanel = true;
    docChatTopicState.current = { error: undefined, isLoading: true, topicId: undefined };

    render(<DocumentBody />);

    expect(screen.queryByTestId('floating-chat-panel')).toBeNull();
  });

  it('renders highlight editor for non-markdown files', () => {
    mockDocumentMeta.current = { content: 'raw log content', filename: 'topic_call.txt' };

    render(<DocumentBody />);

    expect(screen.getByTestId('highlight-editor')).toHaveValue('raw log content');
    expect(screen.queryByTestId('editor-canvas')).toBeNull();
  });

  it('renders EditorCanvas for markdown files', () => {
    mockDocumentMeta.current = { content: '# hi', filename: 'note.md' };

    render(<DocumentBody />);

    expect(screen.getByTestId('editor-canvas')).toBeDefined();
    expect(screen.queryByTestId('highlight-editor')).toBeNull();
  });

  it('renders EditorCanvas for notebook documents that have no filename', () => {
    mockDocumentMeta.current = {
      content: '# notes',
      fileType: 'markdown',
      filename: null,
      title: 'Meeting notes',
    };

    render(<DocumentBody />);

    expect(screen.getByTestId('editor-canvas')).toBeDefined();
    expect(screen.queryByTestId('highlight-editor')).toBeNull();
  });

  it('autosaves highlight editor edits after the debounce window', () => {
    mockDocumentMeta.current = { content: 'before', filename: 'config.json' };

    render(<DocumentBody />);
    const editor = screen.getByTestId('highlight-editor');

    fireEvent.change(editor, { target: { value: 'after' } });
    expect(mockUpdateDocument).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(mockUpdateDocument).toHaveBeenCalledWith({
      content: 'after',
      id: 'document-1',
      saveSource: 'autosave',
    });
  });

  it('flushes pending highlight edits when the editor unmounts', async () => {
    mockDocumentMeta.current = { content: 'before', filename: 'config.json' };

    const { unmount } = render(<DocumentBody />);
    const editor = screen.getByTestId('highlight-editor');

    fireEvent.change(editor, { target: { value: 'after' } });
    expect(mockUpdateDocument).not.toHaveBeenCalled();

    unmount();
    await Promise.resolve();

    expect(mockUpdateDocument).toHaveBeenCalledWith({
      content: 'after',
      id: 'document-1',
      saveSource: 'autosave',
    });
  });

  it('does not save on unmount when the highlight buffer is clean', async () => {
    mockDocumentMeta.current = { content: 'before', filename: 'config.json' };

    const { unmount } = render(<DocumentBody />);

    unmount();
    await Promise.resolve();

    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DocumentBody from './Body';

vi.mock('@/features/FileViewer/FileDocumentPreview', () => ({
  FileDocumentPreview: ({ fileId }: { fileId?: string | null }) => (
    <div data-file-id={fileId} data-testid="original-file-preview" />
  ),
}));

vi.mock('antd-style', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    createStaticStyles: () => ({
      content: 'content',
    }),
    cssVar: {
      colorBgContainer: 'var(--color-bg-container)',
      colorBorderSecondary: 'var(--color-border-secondary)',
      colorTextSecondary: 'var(--color-text-secondary)',
      fontFamilyCode: 'monospace',
    },
  };
});

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
    fileId?: string | null;
    sourceType?: string;
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

vi.mock('./FooterActions', () => ({
  default: () => <div data-testid="footer-actions" />,
}));
// The body no longer resolves a doc-anchored topic itself — the footer's chat
// entry calls `getOrCreateChatTopic` on demand. Keep the mock registered so the
// historical test comments below still name the right constraint owner.
vi.mock('@/features/FloatingChatPanel/useDocumentChatTopic', () => ({
  useDocumentChatTopic: () => ({ error: undefined, isLoading: false, topicId: undefined }),
}));

const mockChatState = vi.hoisted(() => ({
  current: {
    activeTopicId: 'topic-1',
    portalStack: [
      {
        agentDocumentId: 'agent-document-1' as string | undefined,
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
    activeAgentId: 'agent-1' as string | undefined,
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
    internal_dispatchDocument: vi.fn(),
    performSave: vi.fn(),
    updateSkillFrontmatter: vi.fn(),
  },
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: (selector: any) => selector(mockDocumentState.current),
}));

describe('DocumentBody', () => {
  /** @example A file-backed document previews its upload and keeps the portal actions. */
  it('shows the original upload without mounting either editor', () => {
    // ROOT CAUSE:
    // File-backed documents used the empty content field as an editable document.
    // Selecting a file preview must not mount an editor that could save this empty copy.
    mockDocumentMeta.current = { content: '', fileId: 'file-original', filename: 'source.unknown' };
    render(<DocumentBody />);
    /** @example The original file id reaches the read-only preview. */
    expect(screen.getByTestId('original-file-preview').dataset.fileId).toBe('file-original');
    /** @example Neither editor mounts. The portal footer (chat to edit / export)
        replaces the inline conversation panel this PR's body used to render. */
    expect(screen.queryByTestId('highlight-editor')).toBeNull();
    expect(screen.queryByTestId('editor-canvas')).toBeNull();
    expect(screen.getByTestId('footer-actions')).toBeTruthy();
  });

  beforeEach(() => {
    mockAgentState.current.activeAgentId = 'agent-1';
    mockChatState.current.portalStack[0].agentDocumentId = 'agent-document-1';
    mockDocumentMeta.current = { content: '', filename: 'doc.md' };
    mockUpdateDocument.mockClear();
    mockDocumentState.current.internal_dispatchDocument.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the footer actions for an agent document', () => {
    render(<DocumentBody />);

    expect(screen.getByTestId('footer-actions')).toBeDefined();
  });

  it('holds the footer until the document is agent-bound', () => {
    // The useDocumentChatTopic hook is not mounted by the body anymore — the
    // footer's own chat entry resolves the topic on demand. The comment above
    // the original panel tests is kept for history: the NOT_FOUND constraint
    // now lives in ./FooterActions instead of the body's render gate.
    mockChatState.current.portalStack[0].agentDocumentId = undefined;

    render(<DocumentBody />);

    expect(screen.queryByTestId('footer-actions')).toBeNull();
  });

  it('does not render footer actions without an active agent', () => {
    mockAgentState.current.activeAgentId = undefined;

    render(<DocumentBody />);

    expect(screen.queryByTestId('footer-actions')).toBeNull();
  });

  // A plain notebook document is opened as `openDocument(document.id)` — no
  // agentDocumentId. It has no `agent_documents` row, so the footer's
  // `getOrCreateChatTopic` would throw NOT_FOUND. The footer must not render.
  it('does not render footer actions for a plain document with no agentDocumentId', () => {
    mockChatState.current.portalStack[0].agentDocumentId = undefined;

    render(<DocumentBody />);

    expect(screen.queryByTestId('footer-actions')).toBeNull();
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

  it('autosaves highlight editor edits after the debounce window', async () => {
    mockDocumentMeta.current = { content: 'before', filename: 'config.json' };

    render(<DocumentBody />);
    const editor = screen.getByTestId('highlight-editor');

    fireEvent.change(editor, { target: { value: 'after' } });
    expect(mockUpdateDocument).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
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

    await act(async () => {
      unmount();
    });

    expect(mockUpdateDocument).toHaveBeenCalledWith({
      content: 'after',
      id: 'document-1',
      saveSource: 'autosave',
    });
  });

  it('does not save on unmount when the highlight buffer is clean', async () => {
    mockDocumentMeta.current = { content: 'before', filename: 'config.json' };

    const { unmount } = render(<DocumentBody />);

    await act(async () => {
      unmount();
    });

    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('mirrors the live highlight buffer into the document store for export', () => {
    mockDocumentMeta.current = { content: 'before', filename: 'config.json' };

    render(<DocumentBody />);
    const editor = screen.getByTestId('highlight-editor');

    // Initial mount mirrors the persisted content into the store record
    // (the mock record already exists, so this is an update).
    expect(mockDocumentState.current.internal_dispatchDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'document-1',
        type: 'updateDocument',
        value: { content: 'before' },
      }),
    );

    fireEvent.change(editor, { target: { value: 'after' } });

    // The typed buffer becomes the store content immediately, so a concurrent
    // Export downloads the text on screen instead of the last saved copy.
    expect(mockDocumentState.current.internal_dispatchDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'document-1',
        type: 'updateDocument',
        value: { content: 'after' },
      }),
    );
  });
});

/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import AgentDocumentPage from './index';

vi.mock('@/features/FileViewer/FileDocumentPreview', () => ({
  FileDocumentPreview: ({ fileId }: { fileId?: string | null }) => (
    <div data-file-id={fileId} data-testid="original-file-preview" />
  ),
}));

vi.mock('react-router', () => ({
  useParams: () => ({ aid: 'agent-from-url' }),
}));

const pageEditorProps = vi.hoisted(() => ({
  current: undefined as undefined | Record<string, unknown>,
}));

vi.mock('@/features/PageEditor', () => ({
  PageEditor: (props: { header?: ReactNode; pageId?: string }) => {
    pageEditorProps.current = props;
    return (
      <div data-page-id={props.pageId} data-testid="page-editor">
        {props.header}
      </div>
    );
  },
}));

vi.mock('@/features/RightPanel', () => ({
  default: ({ children, expand }: { children?: ReactNode; expand?: boolean }) => (
    <aside data-expand={String(expand)} data-testid="right-panel">
      {children}
    </aside>
  ),
}));

const headerProps = vi.hoisted(() => ({
  current: undefined as undefined | Record<string, unknown>,
}));

vi.mock('./Header', () => ({
  default: (props: Record<string, unknown>) => {
    headerProps.current = props;
    return (
      <div data-document-id={props.documentId as string | undefined} data-testid="header">
        <button
          data-testid="toggle-topic-panel"
          type="button"
          onClick={props.onToggleTopicPanel as () => void}
        />
      </div>
    );
  },
}));

const agentDocumentItemState = vi.hoisted(() => ({
  current: {
    error: undefined as unknown,
    isNotFound: false as boolean | undefined,
    item: { filename: 'spec.md', id: 'agent-document-1', title: 'Spec' } as unknown,
    mutate: vi.fn(),
    skillBundle: undefined as unknown,
  },
}));

vi.mock('./useAgentDocumentItem', () => ({
  useAgentDocumentItem: () => agentDocumentItemState.current,
}));

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
}));

const docChatTopicState = vi.hoisted(() => ({
  current: {
    error: undefined as Error | undefined,
    isLoading: false,
    topicId: 'doc-topic-1' as string | undefined,
  },
}));
// Record the params so a test can assert the lookup never fires for a doc this
// agent doesn't own — `getOrCreateChatTopic` would answer NOT_FOUND.
const docChatTopicCalls = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
vi.mock('@/features/FloatingChatPanel/useDocumentChatTopic', () => ({
  // Mirror the real hook's `enabled` gate: with either id missing it never fetches,
  // so it can only ever return `topicId: undefined`.
  useDocumentChatTopic: (params: Record<string, unknown>) => {
    docChatTopicCalls.current.push(params);
    if (!params.agentId || !params.documentId)
      return { error: undefined, isLoading: false, topicId: undefined };
    return docChatTopicState.current;
  },
}));

const panelProps = vi.hoisted(() => ({
  current: undefined as undefined | Record<string, unknown>,
}));

vi.mock('@/features/FloatingChatPanel', () => ({
  default: (props: Record<string, unknown>) => {
    panelProps.current = props;
    return (
      <div data-testid="floating-chat-panel">
        <button
          data-testid="collapse-topic-panel"
          type="button"
          onClick={props.onCollapse as () => void}
        />
      </div>
    );
  },
}));

describe('AgentDocumentPage', () => {
  /** @example Opening an imported file as a page preserves its original-file preview. */
  it('previews uploads instead of mounting the page editor', () => {
    // ROOT CAUSE:
    // The standalone route always mounted PageEditor, even for file-backed records.
    // It now uses the same file preview as the chat portal and keeps the document chat panel.
    agentDocumentItemState.current.item = {
      fileId: 'file-original',
      filename: 'source.unknown',
      id: 'agent-document-1',
    };
    render(<AgentDocumentPage documentId="docs_uploaded" />);
    /** @example The uploaded file renders without an editable copy. */
    expect(screen.getByTestId('original-file-preview').dataset.fileId).toBe('file-original');
    expect(screen.queryByTestId('page-editor')).toBeNull();
    expect(screen.getByTestId('floating-chat-panel')).toBeTruthy();
  });

  beforeEach(() => {
    agentDocumentItemState.current = {
      error: undefined,
      isNotFound: false,
      item: { filename: 'spec.md', id: 'agent-document-1', title: 'Spec' },
      mutate: vi.fn(),
      skillBundle: undefined,
    };
    docChatTopicState.current = {
      error: undefined,
      isLoading: false,
      topicId: 'doc-topic-1',
    };
    headerProps.current = undefined;
    panelProps.current = undefined;
    pageEditorProps.current = undefined;
    docChatTopicCalls.current = [];
    navigateMock.mockClear();
  });

  afterEach(() => {
    headerProps.current = undefined;
    panelProps.current = undefined;
  });

  it('renders the PageEditor wired to the supplied documentId', () => {
    render(<AgentDocumentPage documentId="docs_abc" />);
    expect(screen.getByTestId('page-editor').dataset.pageId).toBe('docs_abc');
    expect(screen.getByTestId('header').dataset.documentId).toBe('docs_abc');
  });

  it('redirects to the docs index (no header/editor) when the doc is genuinely absent', () => {
    agentDocumentItemState.current = { ...agentDocumentItemState.current, isNotFound: true };

    render(<AgentDocumentPage documentId="docs_missing" />);

    // A deleted/absent doc must not strand the user on a 404 — it redirects to
    // the docs index empty state.
    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-from-url/docs', { replace: true });
    expect(screen.queryByTestId('page-editor')).toBeNull();
    expect(screen.queryByTestId('header')).toBeNull();
  });

  it('passes document list fetch errors to the header', () => {
    const itemError = new Error('metadata failed');
    agentDocumentItemState.current = { ...agentDocumentItemState.current, error: itemError };

    render(<AgentDocumentPage documentId="docs_abc" />);

    expect(headerProps.current).toMatchObject({ itemError });
  });

  it('renders FloatingChatPanel anchored on the URL agent + doc-scoped topic', () => {
    render(<AgentDocumentPage documentId="docs_abc" />);

    const container = screen.getByTestId('right-panel');
    const panel = screen.getByTestId('floating-chat-panel');
    expect(container).toContainElement(panel);
    expect(panelProps.current).toMatchObject({
      agentDocumentId: 'agent-document-1',
      agentId: 'agent-from-url',
      documentId: 'docs_abc',
      topicId: 'doc-topic-1',
    });
    expect(pageEditorProps.current?.askCopilotTarget).toEqual({
      contextKey: messageMapKey({
        agentId: 'agent-from-url',
        documentId: 'docs_abc',
        scope: 'main',
        threadId: null,
        topicId: 'doc-topic-1',
      }),
      writable: true,
    });
  });

  it('skips the panel until the doc-anchored topic id resolves', () => {
    docChatTopicState.current = { error: undefined, isLoading: true, topicId: undefined };
    render(<AgentDocumentPage documentId="docs_abc" />);
    expect(screen.queryByTestId('floating-chat-panel')).toBeNull();
  });

  // `item` comes from this agent's own document list, so it doubles as the
  // ownership proof `getOrCreateChatTopic` requires. Until it resolves, looking up
  // the topic could only produce a NOT_FOUND.
  it('does not look up the doc topic before the agent is known to own the document', () => {
    agentDocumentItemState.current = { ...agentDocumentItemState.current, item: undefined };

    render(<AgentDocumentPage documentId="docs_abc" />);

    expect(screen.queryByTestId('floating-chat-panel')).toBeNull();
    expect(docChatTopicCalls.current.length).toBeGreaterThan(0);
    for (const call of docChatTopicCalls.current) {
      expect(call.agentId).toBeUndefined();
      expect(call.documentId).toBeUndefined();
    }
  });

  it('looks up the doc topic once the document is resolved on this agent', () => {
    render(<AgentDocumentPage documentId="docs_abc" />);

    expect(docChatTopicCalls.current.at(-1)).toMatchObject({
      agentId: 'agent-from-url',
      documentId: 'docs_abc',
    });
  });

  /** @example The topic panel starts collapsed; the header opens it and the panel toolbar closes it. */
  it('opens the topic panel from the header and collapses it from the panel toolbar', () => {
    // ROOT CAUSE:
    // The panel was pinned open with `expand` while the header toggle read and wrote
    // the global `showRightPanel`, so a click only hid the button itself. The page now
    // owns one visibility state: the header toggle opens it, the panel toolbar closes it.
    render(<AgentDocumentPage documentId="docs_abc" />);

    expect(screen.getByTestId('right-panel').dataset.expand).toBe('false');
    expect(headerProps.current?.topicPanelExpand).toBe(false);

    fireEvent.click(screen.getByTestId('toggle-topic-panel'));
    expect(screen.getByTestId('right-panel').dataset.expand).toBe('true');
    expect(headerProps.current?.topicPanelExpand).toBe(true);

    fireEvent.click(screen.getByTestId('collapse-topic-panel'));
    expect(screen.getByTestId('right-panel').dataset.expand).toBe('false');
    expect(headerProps.current?.topicPanelExpand).toBe(false);
  });

  it('hides the topic panel toggle while the page has no topic panel', () => {
    docChatTopicState.current = { error: undefined, isLoading: true, topicId: undefined };
    render(<AgentDocumentPage documentId="docs_abc" />);
    expect(headerProps.current?.topicPanelExpand).toBeUndefined();
  });
});

/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentDocumentPage from './index';

vi.mock('react-router', () => ({
  useParams: () => ({ aid: 'agent-from-url' }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...(props as Record<string, unknown>)}>{children}</div>
  ),
}));

vi.mock('@/features/PageEditor', () => ({
  PageEditor: ({ pageId, header }: { header?: ReactNode; pageId?: string }) => (
    <div data-page-id={pageId} data-testid="page-editor">
      {header}
    </div>
  ),
}));

vi.mock('@/features/WideScreenContainer', () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="wide-screen-container">{children}</div>
  ),
}));

const headerProps = vi.hoisted(() => ({
  current: undefined as undefined | Record<string, unknown>,
}));

vi.mock('./Header', () => ({
  default: (props: Record<string, unknown>) => {
    headerProps.current = props;
    return <div data-document-id={props.documentId as string | undefined} data-testid="header" />;
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
    return <div data-testid="floating-chat-panel" />;
  },
}));

describe('AgentDocumentPage', () => {
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

    const container = screen.getByTestId('wide-screen-container');
    const panel = screen.getByTestId('floating-chat-panel');
    expect(container).toContainElement(panel);
    expect(panelProps.current).toMatchObject({
      agentDocumentId: 'agent-document-1',
      agentId: 'agent-from-url',
      documentId: 'docs_abc',
      topicId: 'doc-topic-1',
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
});

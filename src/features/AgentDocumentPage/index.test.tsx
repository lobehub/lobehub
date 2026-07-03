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

vi.mock('@/components/404', () => ({
  default: () => <div data-testid="not-found" />,
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

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
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

const panelProps = vi.hoisted(() => ({
  current: undefined as undefined | Record<string, unknown>,
}));

vi.mock('@/features/FloatingChatPanel', () => ({
  default: (props: Record<string, unknown>) => {
    panelProps.current = props;
    return <div data-testid="floating-chat-panel" />;
  },
}));

const mockUserState = vi.hoisted(() => ({
  current: {
    preference: { lab: { enableAgentDocumentFloatingChatPanel: false } },
  },
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: any) => selector(mockUserState.current),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: {
    enableAgentDocumentFloatingChatPanel: (s: any) =>
      s.preference.lab.enableAgentDocumentFloatingChatPanel,
  },
}));

describe('AgentDocumentPage', () => {
  beforeEach(() => {
    mockUserState.current.preference.lab.enableAgentDocumentFloatingChatPanel = false;
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

  it('renders the not-found module (no header/editor) when the doc is genuinely absent', () => {
    agentDocumentItemState.current = { ...agentDocumentItemState.current, isNotFound: true };

    render(<AgentDocumentPage documentId="docs_missing" />);

    expect(screen.getByTestId('not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('page-editor')).toBeNull();
    expect(screen.queryByTestId('header')).toBeNull();
  });

  it('passes document list fetch errors to the header', () => {
    const itemError = new Error('metadata failed');
    agentDocumentItemState.current = { ...agentDocumentItemState.current, error: itemError };

    render(<AgentDocumentPage documentId="docs_abc" />);

    expect(headerProps.current).toMatchObject({ itemError });
  });

  it('does not render FloatingChatPanel when the lab feature is disabled', () => {
    render(<AgentDocumentPage documentId="docs_abc" />);
    expect(screen.queryByTestId('floating-chat-panel')).toBeNull();
  });

  it('renders FloatingChatPanel anchored on the URL agent + doc-scoped topic', () => {
    mockUserState.current.preference.lab.enableAgentDocumentFloatingChatPanel = true;
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
    mockUserState.current.preference.lab.enableAgentDocumentFloatingChatPanel = true;
    docChatTopicState.current = { error: undefined, isLoading: true, topicId: undefined };
    render(<AgentDocumentPage documentId="docs_abc" />);
    expect(screen.queryByTestId('floating-chat-panel')).toBeNull();
  });
});

/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TopicPage from './index';

const useParamsMock = vi.hoisted(() => vi.fn());
const useNavigateMock = vi.hoisted(() => vi.fn());
const useClientDataSWRMock = vi.hoisted(() => vi.fn());
const useAutoCreateTopicDocumentMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router-dom')) as typeof import('react-router-dom');

  return {
    ...actual,
    useNavigate: () => useNavigateMock,
    useParams: useParamsMock,
  };
});

vi.mock('swr', () => ({
  mutate: vi.fn(),
}));

vi.mock('@/features/EditorCanvas', () => ({
  AutoSaveHint: ({ documentId }: { documentId: string }) => (
    <div data-document-id={documentId} data-testid="autosave-hint" />
  ),
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (...args: unknown[]) => useClientDataSWRMock(...args),
}));

vi.mock('@/services/document', () => ({
  documentService: {
    getDocumentById: vi.fn(),
    updateDocument: vi.fn(),
  },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentSWRKeys: { documentsList: (id: string) => ['agent-documents-list', id] },
}));

vi.mock('@/store/notebook/action', () => ({
  SWR_USE_FETCH_NOTEBOOK_DOCUMENTS: 'SWR_USE_FETCH_NOTEBOOK_DOCUMENTS',
}));

vi.mock('@/features/TopicCanvas/useAutoCreateTopicDocument', () => ({
  useAutoCreateTopicDocument: (...args: unknown[]) => useAutoCreateTopicDocumentMock(...args),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('@/features/FloatingChatPanel', () => ({
  default: ({
    agentId,
    documentId,
    open,
    scope,
    title,
    topicId,
    variant,
  }: {
    agentId: string;
    documentId?: string;
    open?: boolean;
    scope?: string;
    title?: string;
    topicId: string | null;
    variant?: string;
  }) => (
    <div
      data-agent-id={agentId}
      data-document-id={documentId ?? ''}
      data-open={String(open)}
      data-scope={scope ?? ''}
      data-testid="floating-chat-panel"
      data-title={title ?? ''}
      data-topic-id={topicId ?? 'null'}
      data-variant={variant ?? ''}
    />
  ),
}));

vi.mock('@/features/TopicCanvas', () => ({
  default: ({
    agentId,
    documentId,
    topicId,
  }: {
    agentId?: string;
    documentId?: string;
    topicId?: string | null;
  }) => (
    <div
      data-agent-id={agentId ?? ''}
      data-document-id={documentId ?? ''}
      data-testid="topic-canvas"
      data-topic-id={topicId ?? 'null'}
    />
  ),
}));

describe('Topic page route', () => {
  beforeEach(() => {
    useClientDataSWRMock.mockReset();
    useAutoCreateTopicDocumentMock.mockReset();
    useNavigateMock.mockReset();
    useParamsMock.mockReset();

    useClientDataSWRMock.mockReturnValue({ data: null, error: undefined, isLoading: false });
    useAutoCreateTopicDocumentMock.mockReturnValue({
      document: undefined,
      documentId: undefined,
      isLoading: false,
    });
  });

  it('renders FloatingChatPanel with route topic context', () => {
    useParamsMock.mockReturnValue({
      aid: 'agt_test',
      docId: 'doc_test',
      topicId: 'tpc_test',
    });

    render(<TopicPage />);

    expect(screen.getByTestId('agent-page-container')).toBeInTheDocument();
    expect(screen.getByTestId('topic-canvas')).toHaveAttribute('data-agent-id', 'agt_test');
    expect(screen.getByTestId('topic-canvas')).toHaveAttribute('data-topic-id', 'tpc_test');
    expect(screen.getByTestId('topic-canvas')).toHaveAttribute('data-document-id', 'doc_test');
    expect(screen.getByTestId('floating-chat-panel')).toHaveAttribute('data-agent-id', 'agt_test');
    expect(screen.getByTestId('floating-chat-panel')).toHaveAttribute(
      'data-document-id',
      'doc_test',
    );
    expect(screen.getByTestId('floating-chat-panel')).toHaveAttribute('data-scope', 'page');

    expect(screen.getByTestId('floating-chat-panel')).toHaveAttribute('data-topic-id', 'tpc_test');
    expect(screen.getByTestId('floating-chat-panel')).toHaveAttribute('data-variant', 'embedded');
    expect(useAutoCreateTopicDocumentMock).toHaveBeenCalledWith('tpc_test', 'agt_test');
  });

  it('redirects to the topic page document when the current doc id is invalid', async () => {
    useParamsMock.mockReturnValue({
      aid: 'agt_test',
      docId: 'doc_deleted',
      topicId: 'tpc_test',
    });
    useClientDataSWRMock.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: false,
    });
    useAutoCreateTopicDocumentMock.mockReturnValue({
      document: undefined,
      documentId: 'doc_created',
      isLoading: false,
    });

    render(<TopicPage />);

    await waitFor(() =>
      expect(useNavigateMock).toHaveBeenCalledWith('/agent/agt_test/tpc_test/page/doc_created', {
        replace: true,
      }),
    );
  });

  it('returns null when aid or topicId is missing', () => {
    useParamsMock.mockReturnValue({ aid: 'agt_test' });

    const { container } = render(<TopicPage />);

    expect(container).toBeEmptyDOMElement();
  });
});

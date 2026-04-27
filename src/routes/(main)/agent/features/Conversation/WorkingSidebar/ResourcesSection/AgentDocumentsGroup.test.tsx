import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentDocumentsGroup from './AgentDocumentsGroup';

const useClientDataSWR = vi.fn();
const modalConfirm = vi.hoisted(() => vi.fn());
const messageError = vi.hoisted(() => vi.fn());
const messageSuccess = vi.hoisted(() => vi.fn());
const removeDocumentMock = vi.hoisted(() => vi.fn());
const useMatchMock = vi.hoisted(() => vi.fn());
const useNavigateMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick?: (e: React.MouseEvent) => void; title?: string }) => (
    <button aria-label={title} onClick={onClick}>
      {title}
    </button>
  ),
  Center: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Empty: ({ description }: { description?: ReactNode }) => <div>{description}</div>,
  Flexbox: ({
    children,
    onClick,
    ...props
  }: {
    children?: ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <div onClick={onClick} {...props}>
      {children}
    </div>
  ),
  Text: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { error: messageError, success: messageSuccess },
      modal: { confirm: modalConfirm },
    }),
  },
  Spin: () => <div data-testid="spin" />,
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (...args: unknown[]) => useClientDataSWR(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'workingPanel.resources.empty': 'No agent documents yet',
          'workingPanel.resources.error': 'Failed to load resources',
          'workingPanel.resources.filter.all': 'All',
          'workingPanel.resources.filter.documents': 'Documents',
          'workingPanel.resources.filter.web': 'Web',
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useMatch: () => useMatchMock(),
  useNavigate: () => useNavigateMock,
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentSWRKeys: {
    documents: (agentId: string) => ['agent-documents', agentId],
    documentsList: (agentId: string) => ['agent-documents-list', agentId],
  },
  agentDocumentService: {
    getDocuments: vi.fn(),
    removeDocument: removeDocumentMock,
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { activeAgentId: string }) => unknown) =>
    selector({ activeAgentId: 'agent-1' }),
}));

const openDocument = vi.fn();
const closeDocument = vi.fn();

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ closeDocument, openDocument, portalStack: [] }),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    portalDocumentId: () => null,
  },
}));

describe('AgentDocumentsGroup', () => {
  beforeEach(() => {
    useClientDataSWR.mockReset();
    closeDocument.mockReset();
    modalConfirm.mockReset();
    messageError.mockReset();
    messageSuccess.mockReset();
    openDocument.mockReset();
    removeDocumentMock.mockReset();
    useMatchMock.mockReset();
    useNavigateMock.mockReset();
    useMatchMock.mockReturnValue(null);
    removeDocumentMock.mockResolvedValue({ deleted: true, id: 'doc-1' });
  });

  it('renders documents and opens via openDocument', async () => {
    useClientDataSWR.mockImplementation((key: unknown) => {
      if (Array.isArray(key) && key[0] === 'agent-documents-list') {
        return {
          data: [
            {
              createdAt: new Date('2026-04-16T00:00:00Z'),
              description: 'A short brief',
              documentId: 'doc-content-1',
              filename: 'brief.md',
              id: 'doc-1',
              sourceType: 'file',
              templateId: 'claw',
              title: 'Brief',
            },
          ],
          error: undefined,
          isLoading: false,
          mutate: vi.fn(),
        };
      }

      return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
    });

    render(<AgentDocumentsGroup />);

    const item = await screen.findByText('Brief');
    expect(item).toBeInTheDocument();
    expect(screen.getByText('A short brief')).toBeInTheDocument();

    fireEvent.click(item);
    expect(openDocument).toHaveBeenCalledWith('doc-content-1');
  });

  it('filters documents by source type via segmented tabs', () => {
    useClientDataSWR.mockReturnValue({
      data: [
        {
          createdAt: new Date('2026-04-16T00:00:00Z'),
          description: 'File doc',
          documentId: 'doc-content-1',
          filename: 'brief.md',
          id: 'doc-1',
          sourceType: 'file',
          templateId: 'claw',
          title: 'Brief',
        },
        {
          createdAt: new Date('2026-04-16T00:00:00Z'),
          description: 'Crawled page',
          documentId: 'doc-content-2',
          filename: 'example.com',
          id: 'doc-2',
          sourceType: 'web',
          templateId: null,
          title: 'Example',
        },
      ],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    expect(screen.getByText('Brief')).toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Web'));

    expect(screen.queryByText('Brief')).not.toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Documents'));

    expect(screen.getByText('Brief')).toBeInTheDocument();
    expect(screen.queryByText('Example')).not.toBeInTheDocument();
  });

  it('passes page document and topic context when deleting from a topic page route', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    useMatchMock.mockReturnValue({
      params: { aid: 'agent-1', docId: 'doc-content-1', topicId: 'topic-1' },
    });
    useClientDataSWR.mockReturnValue({
      data: [
        {
          createdAt: new Date('2026-04-16T00:00:00Z'),
          description: 'File doc',
          documentId: 'doc-content-1',
          filename: 'brief.md',
          id: 'doc-1',
          sourceType: 'file',
          templateId: 'claw',
          title: 'Brief',
        },
      ],
      error: undefined,
      isLoading: false,
      mutate,
    });

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByLabelText('delete'));

    const [firstConfirmCall] = modalConfirm.mock.calls;
    const [{ onOk }] = firstConfirmCall;
    await onOk();

    expect(closeDocument).toHaveBeenCalled();
    expect(removeDocumentMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      documentId: 'doc-content-1',
      id: 'doc-1',
      topicId: 'topic-1',
    });
    expect(mutate).toHaveBeenCalled();
    expect(messageSuccess).toHaveBeenCalledWith('workingPanel.resources.deleteSuccess');
  });

  it('renders empty state when no documents', () => {
    useClientDataSWR.mockReturnValue({
      data: [],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    expect(screen.getByText('No agent documents yet')).toBeInTheDocument();
  });

  it('renders error state', () => {
    useClientDataSWR.mockReturnValue({
      data: [],
      error: new Error('oops'),
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    expect(screen.getByText('Failed to load resources')).toBeInTheDocument();
  });
});

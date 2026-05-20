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
    t: (key: string, options?: { time?: string }) =>
      (
        ({
          'workingPanel.resources.empty': 'No agent documents yet',
          'workingPanel.resources.error': 'Failed to load resources',
          'workingPanel.resources.filter.all': 'All',
          'workingPanel.resources.filter.documents': 'Documents',
          'workingPanel.resources.filter.web': 'Web',
          'workingPanel.resources.updatedAt': `Updated ${options?.time}`,
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useMatch: () => useMatchMock(),
  useNavigate: () => useNavigateMock,
}));

vi.mock('@/features/AgentDocumentsExplorer', () => ({
  DocumentExplorerTree: ({ data }: { data: unknown[] }) => (
    <div data-doc-count={data.length} data-testid="document-explorer-tree" />
  ),
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
              updatedAt: new Date(),
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

    const item = screen.getByText('Brief');
    expect(item).toBeInTheDocument();
    expect(screen.getByText('A short brief')).toBeInTheDocument();
    expect(screen.getByText('Updated a few seconds ago')).toBeInTheDocument();

    fireEvent.click(item);
    expect(openDocument).toHaveBeenCalledWith('doc-content-1');
  });

  it('opens a managed skill bundle card through its SKILL.md document and hides the duplicate file', () => {
    useClientDataSWR.mockReturnValue({
      data: [
        {
          createdAt: new Date('2026-05-09T00:00:00Z'),
          description: 'Use for YouTube comments',
          documentId: 'skill-bundle-doc',
          fileType: 'skills/bundle',
          filename: 'youtube-comment-retrieval-workflow',
          id: 'skill-bundle-row',
          parentId: null,
          sourceType: 'agent-signal',
          templateId: 'agent-skill',
          title: 'YouTube Comment Retrieval Workflow',
          updatedAt: new Date(),
        },
        {
          createdAt: new Date('2026-05-09T00:00:00Z'),
          description: 'Use for YouTube comments',
          documentId: 'skill-index-doc',
          fileType: 'skills/index',
          filename: 'SKILL.md',
          id: 'skill-index-row',
          parentId: 'skill-bundle-doc',
          sourceType: 'agent-signal',
          templateId: 'agent-skill',
          title: 'SKILL.md',
          updatedAt: new Date(),
        },
      ],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    const bundle = screen.getByText('YouTube Comment Retrieval Workflow');
    expect(bundle).toBeInTheDocument();
    expect(screen.queryByText('SKILL.md')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('delete')).not.toBeInTheDocument();

    fireEvent.click(bundle);

    expect(openDocument).toHaveBeenCalledWith('skill-index-doc');
    expect(openDocument).not.toHaveBeenCalledWith('skill-bundle-doc');
  });

  it('renders the empty state when only hidden managed skill index documents are available', () => {
    useClientDataSWR.mockReturnValue({
      data: [
        {
          createdAt: new Date('2026-05-09T00:00:00Z'),
          description: 'Use for YouTube comments',
          documentId: 'skill-index-doc',
          fileType: 'skills/index',
          filename: 'SKILL.md',
          id: 'skill-index-row',
          parentId: 'missing-skill-bundle-doc',
          sourceType: 'agent-signal',
          templateId: 'agent-skill',
          title: 'SKILL.md',
          updatedAt: new Date(),
        },
      ],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    expect(screen.getByText('No agent documents yet')).toBeInTheDocument();
    expect(screen.queryByText('SKILL.md')).not.toBeInTheDocument();
  });

  it('navigates to the page route when opening from a topic page', () => {
    useMatchMock.mockReturnValue({
      params: { aid: 'agent-1', topicId: 'topic-1' },
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
          updatedAt: null,
        },
      ],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByText('Brief'));

    expect(useNavigateMock).toHaveBeenCalledWith('/agent/agent-1/topic-1/page/doc-content-1');
    expect(openDocument).not.toHaveBeenCalled();
  });

  it('allows opening and deleting an orphan managed skill bundle as a recovery path', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    useClientDataSWR.mockReturnValue({
      data: [
        {
          createdAt: new Date('2026-05-09T00:00:00Z'),
          description: 'Missing SKILL.md',
          documentId: 'skill-bundle-doc',
          fileType: 'skills/bundle',
          filename: 'youtube-comment-retrieval-workflow',
          id: 'skill-bundle-row',
          parentId: null,
          sourceType: 'agent-signal',
          templateId: 'agent-skill',
          title: 'YouTube Comment Retrieval Workflow',
          updatedAt: new Date(),
        },
      ],
      error: undefined,
      isLoading: false,
      mutate,
    });

    render(<AgentDocumentsGroup />);

    const bundle = screen.getByText('YouTube Comment Retrieval Workflow');
    expect(screen.getByLabelText('delete')).toBeInTheDocument();

    fireEvent.click(bundle);
    expect(openDocument).toHaveBeenCalledWith('skill-bundle-doc');

    fireEvent.click(screen.getByLabelText('delete'));

    const [firstConfirmCall] = modalConfirm.mock.calls;
    const [{ onOk }] = firstConfirmCall;
    await onOk();

    expect(removeDocumentMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      documentId: 'skill-bundle-doc',
      id: 'skill-bundle-row',
      topicId: undefined,
    });
    expect(mutate).toHaveBeenCalled();
  });

  it('shows an error message when deleting a document fails', async () => {
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
          updatedAt: new Date(),
        },
      ],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });
    removeDocumentMock.mockRejectedValue(new Error('delete failed'));

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByLabelText('delete'));

    const [firstConfirmCall] = modalConfirm.mock.calls;
    const [{ onOk }] = firstConfirmCall;
    await onOk();

    expect(messageError).toHaveBeenCalledWith('delete failed');
  });

  it('renders grouped cards in tree view mode', () => {
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
          updatedAt: new Date(),
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
          updatedAt: null,
        },
      ],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup viewMode="tree" />);

    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('Web')).toBeInTheDocument();
    expect(screen.getByText('Brief')).toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.queryByTestId('document-explorer-tree')).not.toBeInTheDocument();
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
          updatedAt: new Date(),
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
          updatedAt: new Date(),
        },
      ],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    expect(screen.getByText('Brief')).toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.queryByTestId('document-explorer-tree')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Web'));

    expect(screen.queryByText('Brief')).not.toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.queryByTestId('document-explorer-tree')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Documents'));

    const tree = screen.getByTestId('document-explorer-tree');
    expect(tree).toBeInTheDocument();
    expect(tree).toHaveAttribute('data-doc-count', '2');
    expect(screen.queryByText('Brief')).not.toBeInTheDocument();
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
          updatedAt: new Date(),
        },
      ],
      error: undefined,
      isLoading: false,
      mutate,
    });

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByLabelText('delete'));

    expect(modalConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelText: 'cancel',
        centered: true,
        okButtonProps: { danger: true, type: 'primary' },
        okText: 'delete',
        title: 'workingPanel.resources.deleteTitle',
      }),
    );

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

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentDocumentsGroup from './AgentDocumentsGroup';

const useClientDataSWR = vi.fn();
const modalConfirm = vi.hoisted(() => vi.fn());
const messageError = vi.hoisted(() => vi.fn());
const messageSuccess = vi.hoisted(() => vi.fn());
const removeDocumentMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  Accordion: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <div>
      {title}
      {children}
    </div>
  ),
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
}));

vi.mock('@/components/NeuralNetworkLoading', () => ({
  default: () => <div data-testid="neural-network-loading" />,
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
          'workingPanel.resources.filter.documents': 'Documents',
          'workingPanel.resources.filter.skills': 'Skills',
          'workingPanel.resources.filter.web': 'Web',
          'workingPanel.resources.updatedAt': `Updated ${options?.time}`,
          'workingPanel.skills.empty': 'No skills found',
          'workingPanel.skills.section.agent': 'Agent skills',
          'workingPanel.skills.section.project': 'Project skills',
          'workingPanel.skills.section.user': 'User skills',
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('@/features/AgentDocumentsExplorer', () => ({
  DocumentExplorerTree: ({ data }: { data: unknown[] }) => (
    <div data-doc-count={data.length} data-testid="document-explorer-tree" />
  ),
}));

vi.mock('@/features/SkillsList', () => {
  type Item = { fileCount?: number; id: string; name: string };
  const SkillsList = ({
    items,
    onOpenFile,
    onOpenSkill,
  }: {
    items: Item[];
    onOpenFile?: (item: Item, relativePath: string) => void;
    onOpenSkill?: (item: Item) => void;
  }) => (
    <div data-testid="skills-list">
      {items.map((item) => (
        <div data-skill-id={item.id} key={item.id}>
          <button onClick={() => onOpenSkill?.(item)}>{item.name}</button>
          <span data-testid={`skill-${item.id}-count`}>{item.fileCount}</span>
          <button
            data-testid={`skill-${item.id}-open-skill-md`}
            onClick={() => onOpenFile?.(item, 'SKILL.md')}
          >
            open-skill-md
          </button>
        </div>
      ))}
    </div>
  );
  // SkillSection is a thin presentational wrapper — the real one swaps the
  // children for an empty placeholder when `isEmpty` is true. We mirror that
  // here so co-located assertions (e.g. "skills-list does not render when no
  // bundles are present") line up with production behavior.
  const SkillSection = ({
    children,
    emptyText,
    isEmpty,
    sectionHeader,
  }: {
    children?: ReactNode;
    emptyText?: string;
    isEmpty?: boolean;
    sectionHeader?: { count?: number; title: string };
  }) => (
    <div data-testid={sectionHeader ? `skill-section-${sectionHeader.title}` : 'skill-section'}>
      {sectionHeader && (
        <div data-testid="skill-section-header">
          <span>{sectionHeader.title}</span>
          {typeof sectionHeader.count === 'number' && <span>{sectionHeader.count}</span>}
        </div>
      )}
      {isEmpty ? <div data-testid="skill-section-empty">{emptyText}</div> : children}
    </div>
  );
  const useProjectSkills = () => ({
    isLoading: false,
    items: [],
    onOpenFile: () => undefined,
    onOpenSkill: () => undefined,
    raw: undefined,
  });
  return { SkillSection, SkillsList, useProjectSkills };
});

// UserLevelSkills owns its own store wiring and is exercised separately. We
// stub it (component + the lifted hook) so AgentDocumentsGroup's render logic
// can be tested without dragging the tool store into the working-sidebar
// tests. Default to an empty user-skill list so the empty-state branch is
// reachable; individual tests can re-mock before render to override.
vi.mock('./UserLevelSkills', () => ({
  default: () => null,
  useUserSkills: () => [],
}));
vi.mock('@/features/ChatInput/InputEditor/ActionTag/skillDragData', () => ({
  startSkillDrag: () => undefined,
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
  useAgentStore: (selector: (state: { activeAgentId: string; agentMap: object }) => unknown) =>
    selector({ activeAgentId: 'agent-1', agentMap: {} }),
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

const skillBundleRow = {
  category: 'skill',
  createdAt: new Date('2026-05-09T00:00:00Z'),
  description: 'Use for YouTube comments',
  documentId: 'skill-bundle-doc',
  fileType: 'skills/bundle',
  filename: 'youtube-comment-retrieval-workflow',
  id: 'skill-bundle-row',
  isFolder: true,
  isSkillBundle: true,
  isSkillIndex: false,
  parentId: null,
  sourceType: 'agent-signal',
  templateId: 'agent-skill',
  title: 'YouTube Comment Retrieval Workflow',
  updatedAt: new Date(),
};

const skillIndexRow = {
  category: 'skill',
  createdAt: new Date('2026-05-09T00:00:00Z'),
  description: 'Use for YouTube comments',
  documentId: 'skill-index-doc',
  fileType: 'skills/index',
  filename: 'SKILL.md',
  id: 'skill-index-row',
  isFolder: false,
  isSkillBundle: false,
  isSkillIndex: true,
  parentId: 'skill-bundle-doc',
  sourceType: 'agent-signal',
  templateId: 'agent-skill',
  title: 'SKILL.md',
  updatedAt: new Date(),
};

const fileDocRow = {
  category: 'document',
  createdAt: new Date('2026-04-16T00:00:00Z'),
  description: 'A short brief',
  documentId: 'doc-content-1',
  fileType: 'agent/document',
  filename: 'brief.md',
  id: 'doc-1',
  isFolder: false,
  isSkillBundle: false,
  isSkillIndex: false,
  parentId: null,
  sourceType: 'file',
  templateId: null,
  title: 'Brief',
  updatedAt: new Date(),
};

const webDocRow = {
  category: 'web',
  createdAt: new Date('2026-04-16T00:00:00Z'),
  description: 'Crawled page',
  documentId: 'doc-content-2',
  fileType: 'article',
  filename: 'example.com',
  id: 'doc-2',
  isFolder: false,
  isSkillBundle: false,
  isSkillIndex: false,
  parentId: null,
  sourceType: 'web',
  templateId: null,
  title: 'Example',
  updatedAt: new Date(),
};

describe('AgentDocumentsGroup', () => {
  beforeEach(() => {
    useClientDataSWR.mockReset();
    closeDocument.mockReset();
    modalConfirm.mockReset();
    messageError.mockReset();
    messageSuccess.mockReset();
    openDocument.mockReset();
    removeDocumentMock.mockReset();
    removeDocumentMock.mockResolvedValue({ deleted: true, id: 'doc-1' });
  });

  it('defaults to the Skills tab and renders skill bundles via SkillsList', () => {
    useClientDataSWR.mockReturnValue({
      data: [skillBundleRow, skillIndexRow, fileDocRow, webDocRow],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    const list = screen.getByTestId('skills-list');
    expect(list).toBeInTheDocument();
    expect(screen.getByText('YouTube Comment Retrieval Workflow')).toBeInTheDocument();
    // bundle's file children count (the SKILL.md row collapsed inside the expand panel)
    expect(screen.getByTestId('skill-skill-bundle-doc-count')).toHaveTextContent('1');
    // file / web docs should not leak into the skills tab
    expect(screen.queryByText('Brief')).not.toBeInTheDocument();
    expect(screen.queryByText('Example')).not.toBeInTheDocument();
  });

  it('opens the SKILL.md document when clicking a skill bundle row', () => {
    useClientDataSWR.mockReturnValue({
      data: [skillBundleRow, skillIndexRow],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByText('YouTube Comment Retrieval Workflow'));
    expect(openDocument).toHaveBeenCalledWith('skill-index-doc', 'skill-index-row');
  });

  it('falls back to the bundle id when opening an orphan skill bundle', () => {
    useClientDataSWR.mockReturnValue({
      data: [skillBundleRow], // no SKILL.md child
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByText('YouTube Comment Retrieval Workflow'));
    expect(openDocument).toHaveBeenCalledWith('skill-bundle-doc', 'skill-bundle-row');
  });

  it('opens a child file by relative path through onOpenFile', () => {
    useClientDataSWR.mockReturnValue({
      data: [skillBundleRow, skillIndexRow],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByTestId('skill-skill-bundle-doc-open-skill-md'));
    expect(openDocument).toHaveBeenCalledWith('skill-index-doc', 'skill-index-row');
  });

  it('renders the document tree when switching to the Documents tab', () => {
    useClientDataSWR.mockReturnValue({
      data: [skillBundleRow, skillIndexRow, fileDocRow, webDocRow],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByText('Documents'));

    const tree = screen.getByTestId('document-explorer-tree');
    expect(tree).toBeInTheDocument();
    // Skill bundle, skill index, and web items are filtered out before reaching
    // the tree — only the file-backed document survives.
    expect(tree).toHaveAttribute('data-doc-count', '1');
  });

  it('renders web items as cards in the Web tab and supports deletion', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    useClientDataSWR.mockReturnValue({
      data: [fileDocRow, webDocRow],
      error: undefined,
      isLoading: false,
      mutate,
    });

    render(<AgentDocumentsGroup />);
    fireEvent.click(screen.getByText('Web'));

    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.queryByText('Brief')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Example'));
    expect(openDocument).toHaveBeenCalledWith('doc-content-2', 'doc-2');

    fireEvent.click(screen.getByLabelText('delete'));
    const [firstConfirmCall] = modalConfirm.mock.calls;
    const [{ onOk }] = firstConfirmCall;
    await onOk();

    expect(removeDocumentMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      documentId: 'doc-content-2',
      id: 'doc-2',
    });
    expect(mutate).toHaveBeenCalled();
    expect(messageSuccess).toHaveBeenCalledWith('workingPanel.resources.deleteSuccess');
  });

  it('falls back to a single empty placeholder when every skill source is empty', () => {
    useClientDataSWR.mockReturnValue({
      data: [fileDocRow, webDocRow],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    // No agent bundles, no working dir (no Project section), no user-installed
    // skills → renderSkills collapses to the global "No skills found"
    // placeholder rather than rendering an empty section per source.
    expect(screen.getByText('No skills found')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-list')).not.toBeInTheDocument();
  });

  it('shows the web empty state when no web items are present', () => {
    useClientDataSWR.mockReturnValue({
      data: [fileDocRow],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);
    fireEvent.click(screen.getByText('Web'));

    expect(screen.getByText('No agent documents yet')).toBeInTheDocument();
  });

  it('renders error state when SWR returns an error', () => {
    useClientDataSWR.mockReturnValue({
      data: [],
      error: new Error('oops'),
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);

    expect(screen.getByText('Failed to load resources')).toBeInTheDocument();
  });

  it('renders the loading spinner while data is being fetched', () => {
    useClientDataSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);
    expect(screen.getByTestId('neural-network-loading')).toBeInTheDocument();
  });
});

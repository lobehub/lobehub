import {
  AGENT_DOCUMENT_CATEGORY,
  AGENT_DOCUMENT_FILE_TYPE,
  AGENT_DOCUMENT_SKILL_CATEGORY,
  AGENT_SIGNAL_SOURCE_TYPE,
} from '@lobechat/const';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type * as ReactRouterDom from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentDocumentsGroup from './AgentDocumentsGroup';

// What the agent's document-list replica holds for this render
// (`data` undefined = no entry yet) and its sync flags.
const documentListMock = vi.hoisted(() => vi.fn());
const documentListState = (): {
  data?: unknown[];
  error?: unknown;
  mutate?: (...args: unknown[]) => unknown;
} => documentListMock() ?? {};
const useProjectSkillsMock = vi.hoisted(() => vi.fn());
const modalConfirm = vi.hoisted(() => vi.fn());
const messageError = vi.hoisted(() => vi.fn());
const messageSuccess = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const openDocumentMock = vi.hoisted(() => vi.fn());
const editorMock = vi.hoisted(() => ({ dispatchCommand: vi.fn(), focus: vi.fn() }));
const removeDocumentMock = vi.hoisted(() => vi.fn());
const useParamsMock = vi.hoisted(() => vi.fn());
const documentExplorerShouldThrow = vi.hoisted(() => ({ current: false }));
const userSkillInventory = vi.hoisted(() => ({
  canManage: true,
  enabledIds: [] as string[],
  items: [] as { id: string; name: string }[],
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
  confirmModal: modalConfirm,
  toast: { error: messageError, success: messageSuccess },
}));

vi.mock('@/components/AsyncError', () => ({
  default: ({ onRetry }: { onRetry?: () => void }) => (
    <button data-testid="async-error" onClick={onRetry}>
      async-error
    </button>
  ),
}));

vi.mock('@/store/agentDocument', () => ({
  agentDocumentActions: {
    mutateDocumentList: (_agentId: string, ...args: unknown[]) =>
      documentListState().mutate?.(...args),
    useFetchDocumentList: () => ({ error: documentListState().error }),
  },
  agentDocumentSelectors: { getDocumentList: () => () => documentListState().data },
  useAgentDocumentStore: (selector: (state: unknown) => unknown) => selector({}),
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
          'workingPanel.skills.manage.title': 'Manage user skills',
          'workingPanel.skills.section.agent': 'Agent skills',
          'workingPanel.skills.section.device': 'Device skills',
          'workingPanel.skills.section.project': 'Project skills',
          'workingPanel.skills.section.user': 'User skills',
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('@/features/AgentDocumentsExplorer', () => ({
  DocumentExplorerTree: ({
    data,
    onOpenDocument,
  }: {
    data: { documentId: string; id: string; title?: string }[];
    onOpenDocument?: (documentId: string, agentDocumentId?: string) => void;
  }) =>
    documentExplorerShouldThrow.current ? (
      (() => {
        throw new Error('document tree render failed');
      })()
    ) : (
      <div data-doc-count={data.length} data-testid="document-explorer-tree">
        {data.map((doc) => (
          <button
            data-testid={`tree-open-${doc.id}`}
            key={doc.id}
            onClick={() => onOpenDocument?.(doc.documentId, doc.id)}
          >
            {doc.title}
          </button>
        ))}
      </div>
    ),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
}));

vi.mock('@/features/SkillsList', async () => {
  const { filterSkillItems } = await import('@/features/SkillsList/filterSkillItems');
  const { default: SkillsSearchBar } = await import('@/features/SkillsList/SkillsSearchBar');
  const { default: ActualSkillsList } = await import('@/features/SkillsList/SkillsList');
  const SkillsList = (props: ComponentProps<typeof ActualSkillsList>) => (
    <div data-testid="skills-list">
      <ActualSkillsList {...props} />
    </div>
  );
  const { default: ActualSkillSection } = await import('@/features/SkillsList/SkillSection');
  const SkillSection = (props: ComponentProps<typeof ActualSkillSection>) => (
    <div
      data-testid={
        props.sectionHeader ? `skill-section-${props.sectionHeader.title}` : 'skill-section'
      }
    >
      <ActualSkillSection {...props} />
    </div>
  );
  const useProjectSkills = (...args: unknown[]) => useProjectSkillsMock(...args);
  return { filterSkillItems, SkillSection, SkillsList, SkillsSearchBar, useProjectSkills };
});

vi.mock('./useCanManageUserSkills', () => ({
  useCanManageUserSkills: () => userSkillInventory.canManage,
}));
// Keep the real user-skill section and accordion so header interactions are covered.
vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: object) => unknown) =>
    selector({ useFetchAgentSkills: () => undefined }),
}));
vi.mock('@/store/tool/selectors', () => ({
  agentSkillsSelectors: {
    getAgentSkills: () =>
      userSkillInventory.items.map((item) => ({
        identifier: item.id,
        name: item.name,
      })),
  },
}));
vi.mock('@/features/ChatInput/InputEditor/ActionTag/skillDragData', () => ({
  startSkillDrag: () => undefined,
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    getDocuments: vi.fn(),
    removeDocument: removeDocumentMock,
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { activeAgentId: string; agentMap: object }) => unknown) =>
    selector({
      activeAgentId: 'agent-1',
      agentMap: { 'agent-1': { plugins: userSkillInventory.enabledIds } },
    }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (
    selector: (state: {
      mainInputEditor: { instance: typeof editorMock };
      openDocument: typeof openDocumentMock;
    }) => unknown,
  ) => selector({ mainInputEditor: { instance: editorMock }, openDocument: openDocumentMock }),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router');
  return {
    ...actual,
    useParams: useParamsMock,
  };
});

const skillBundleRow = {
  category: AGENT_DOCUMENT_SKILL_CATEGORY,
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
  sourceType: AGENT_SIGNAL_SOURCE_TYPE,
  templateId: 'agent-skill',
  title: 'YouTube Comment Retrieval Workflow',
  updatedAt: new Date(),
};

const skillIndexRow = {
  category: AGENT_DOCUMENT_SKILL_CATEGORY,
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
  sourceType: AGENT_SIGNAL_SOURCE_TYPE,
  templateId: 'agent-skill',
  title: 'SKILL.md',
  updatedAt: new Date(),
};

const fileDocRow = {
  category: AGENT_DOCUMENT_CATEGORY,
  createdAt: new Date('2026-04-16T00:00:00Z'),
  description: 'A short brief',
  documentId: 'doc-content-1',
  fileType: AGENT_DOCUMENT_FILE_TYPE,
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

const mixedDocumentListState = () => ({
  data: [skillBundleRow, skillIndexRow, fileDocRow, webDocRow],
  error: undefined,
  isLoading: false,
  mutate: vi.fn(),
});

const skillDocumentListState = () => ({
  data: [skillBundleRow, skillIndexRow],
  error: undefined,
  isLoading: false,
  mutate: vi.fn(),
});

const fileDocumentListState = () => ({
  data: [fileDocRow, webDocRow],
  error: undefined,
  isLoading: false,
  mutate: vi.fn(),
});

const singleFileListState = () => ({
  data: [fileDocRow],
  error: undefined,
  isLoading: false,
  mutate: vi.fn(),
});

describe('AgentDocumentsGroup', () => {
  beforeEach(() => {
    documentListMock.mockReset();
    useProjectSkillsMock.mockReset();
    useProjectSkillsMock.mockReturnValue({
      deviceItems: [],
      error: undefined,
      isLoading: false,
      items: [],
      mutate: vi.fn(),
      onOpenSkill: () => undefined,
      projectItems: [],
      raw: undefined,
    });
    modalConfirm.mockReset();
    messageError.mockReset();
    messageSuccess.mockReset();
    navigateMock.mockReset();
    openDocumentMock.mockReset();
    editorMock.dispatchCommand.mockReset();
    editorMock.focus.mockReset();
    removeDocumentMock.mockReset();
    removeDocumentMock.mockResolvedValue({ deleted: true, id: 'doc-1' });
    useParamsMock.mockReturnValue({});
    documentExplorerShouldThrow.current = false;
    userSkillInventory.items = [];
    userSkillInventory.enabledIds = [];
    userSkillInventory.canManage = true;
  });

  it('opens the agent skills settings even when every user skill is disabled', () => {
    documentListMock.mockReturnValue({ data: [] });
    userSkillInventory.items = [{ id: 'disabled-skill', name: 'Disabled skill' }];
    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage user skills' }));
    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-1/skills');
    expect(screen.queryByText('Disabled skill')).not.toBeInTheDocument();
  });

  it('keeps the user skills collapsible with an independently clickable settings action', () => {
    documentListMock.mockReturnValue({ data: [] });
    userSkillInventory.items = [{ id: 'writing', name: 'Writing skill' }];
    userSkillInventory.enabledIds = ['writing'];
    render(<AgentDocumentsGroup />);

    const header = screen.getByRole('button', { name: /User skills/ });
    const settings = screen.getByRole('button', { name: 'Manage user skills' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(header.contains(settings)).toBe(false);
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    // The action stays mounted and focusable while collapsed; the compact header
    // only reveals it on hover / focus-within.
    expect(settings).toBeInTheDocument();
    expect(settings).toBeEnabled();
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    fireEvent.click(settings);
    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-1/skills');
  });

  it('does not offer management to a read-only viewer', () => {
    documentListMock.mockReturnValue({ data: [] });
    userSkillInventory.items = [{ id: 'disabled-skill', name: 'Disabled skill' }];
    userSkillInventory.canManage = false;
    render(<AgentDocumentsGroup />);
    expect(screen.queryByRole('button', { name: 'Manage user skills' })).not.toBeInTheDocument();
  });

  it('defaults to the Skills tab and renders skill bundles via SkillsList', () => {
    documentListMock.mockReturnValue(mixedDocumentListState());

    render(<AgentDocumentsGroup />);

    const list = screen.getByTestId('skills-list');
    expect(list).toBeInTheDocument();
    expect(screen.getByText('YouTube Comment Retrieval Workflow')).toBeInTheDocument();
    expect(within(list).queryByText('1')).not.toBeInTheDocument();
    // file / web docs should not leak into the skills tab
    expect(screen.queryByText('Brief')).not.toBeInTheDocument();
    expect(screen.queryByText('Example')).not.toBeInTheDocument();
  });

  it('renders project and device filesystem skills as separate sections', () => {
    const projectItem = {
      id: 'project-skill',
      name: 'project-writer',
      scope: 'project' as const,
    };
    const deviceItem = {
      id: 'device-skill',
      name: 'device-writer',
      scope: 'device' as const,
    };
    useProjectSkillsMock.mockReturnValue({
      deviceItems: [deviceItem],
      error: undefined,
      isLoading: false,
      items: [projectItem, deviceItem],
      mutate: vi.fn(),
      onOpenSkill: () => undefined,
      projectItems: [projectItem],
      raw: undefined,
    });
    documentListMock.mockReturnValue(fileDocumentListState());

    render(<AgentDocumentsGroup showLocalProjectSkills workingDirectory="/repo" />);

    expect(screen.getByTestId('skill-section-Project skills')).toBeInTheDocument();
    expect(screen.getByTestId('skill-section-Device skills')).toBeInTheDocument();
    expect(screen.getByText('project-writer')).toBeInTheDocument();
    expect(screen.getByText('device-writer')).toBeInTheDocument();
  });

  it('keeps the filesystem skill scan inert while the pane is disabled', () => {
    const projectItem = {
      description: 'writes things',
      files: [],
      id: 'project-skill',
      name: 'project-writer',
      scope: 'project' as const,
    };
    useProjectSkillsMock.mockReturnValue({
      deviceItems: [],
      error: undefined,
      isLoading: false,
      items: [projectItem],
      mutate: vi.fn(),
      onOpenSkill: () => undefined,
      projectItems: [projectItem],
      raw: undefined,
    });
    documentListMock.mockReturnValue({
      data: [],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup showLocalProjectSkills enabled={false} workingDirectory="/repo" />);

    // `undefined` workingDirectory is the hook's documented inert mode: no scan fires.
    expect(useProjectSkillsMock).toHaveBeenCalledWith(undefined, undefined);
    expect(screen.queryByTestId('skills-list')).not.toBeInTheDocument();
    expect(screen.queryByText('project-writer')).not.toBeInTheDocument();
  });

  it('inserts a skill tag into the composer when clicking a skill bundle row', () => {
    documentListMock.mockReturnValue(skillDocumentListState());

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByText('YouTube Comment Retrieval Workflow'));
    expect(editorMock.focus).toHaveBeenCalledOnce();
    expect(editorMock.dispatchCommand).toHaveBeenCalledWith(expect.anything(), {
      category: 'agentSkill',
      label: 'YouTube Comment Retrieval Workflow',
      skipIfExists: true,
      type: 'agent-skills:youtube-comment-retrieval-workflow',
    });
    expect(openDocumentMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows no management actions or file counts on hover or right-click', () => {
    documentListMock.mockReturnValue(skillDocumentListState());

    render(<AgentDocumentsGroup />);

    const list = screen.getByTestId('skills-list');
    const row = within(list).getByRole('button', { name: 'YouTube Comment Retrieval Workflow' });
    fireEvent.mouseEnter(row);
    fireEvent.contextMenu(row);

    expect(within(list).getAllByRole('button')).toHaveLength(1);
    expect(within(list).queryByText('1')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(editorMock.dispatchCommand).not.toHaveBeenCalled();
    expect(openDocumentMock).not.toHaveBeenCalled();
    expect(modalConfirm).not.toHaveBeenCalled();
  });

  it('falls back to the bundle id when opening an orphan skill bundle in document mode', () => {
    useParamsMock.mockReturnValue({ docId: 'doc-content-1' });
    documentListMock.mockReturnValue({
      data: [skillBundleRow], // no SKILL.md child
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup activeFilter="skills" />);

    fireEvent.click(screen.getByText('YouTube Comment Retrieval Workflow'));
    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-1/docs/skill-bundle-doc');
    expect(editorMock.dispatchCommand).not.toHaveBeenCalled();
  });

  it('selects a skill with the keyboard without exposing its file tree', () => {
    documentListMock.mockReturnValue(skillDocumentListState());

    render(<AgentDocumentsGroup />);

    const row = screen.getByRole('button', { name: 'YouTube Comment Retrieval Workflow' });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(editorMock.dispatchCommand).toHaveBeenCalledOnce();
    expect(screen.queryByText('SKILL.md')).not.toBeInTheDocument();
    expect(openDocumentMock).not.toHaveBeenCalled();
  });

  it('routes directly when opening a skill from document mode', () => {
    useParamsMock.mockReturnValue({ docId: 'doc-content-1' });
    documentListMock.mockReturnValue(skillDocumentListState());

    render(<AgentDocumentsGroup activeFilter="skills" />);

    fireEvent.click(screen.getByText('YouTube Comment Retrieval Workflow'));
    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-1/docs/skill-index-doc');
    expect(editorMock.dispatchCommand).not.toHaveBeenCalled();
    expect(openDocumentMock).not.toHaveBeenCalled();
  });

  it('renders the document tree when switching to the Documents tab', () => {
    documentListMock.mockReturnValue(mixedDocumentListState());

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByText('Documents'));

    const tree = screen.getByTestId('document-explorer-tree');
    expect(tree).toBeInTheDocument();
    // Skill bundle, skill index, and web items are filtered out before reaching
    // the tree — only the file-backed document survives.
    expect(tree).toHaveAttribute('data-doc-count', '1');
  });

  it('contains document tree render failures in an alert boundary', () => {
    documentExplorerShouldThrow.current = true;
    documentListMock.mockReturnValue(singleFileListState());

    render(<AgentDocumentsGroup activeFilter="documents" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Render Error');
    expect(screen.getByRole('alert')).toHaveTextContent('document tree render failed');
  });

  it('opens document tree files in the portal by default', () => {
    documentListMock.mockReturnValue(mixedDocumentListState());

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByText('Documents'));
    fireEvent.click(screen.getByTestId('tree-open-doc-1'));

    expect(openDocumentMock).toHaveBeenCalledWith('doc-content-1', 'doc-1');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('routes document tree files directly in document mode', () => {
    useParamsMock.mockReturnValue({ docId: 'doc-content-1' });
    documentListMock.mockReturnValue(mixedDocumentListState());

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByTestId('tree-open-doc-1'));

    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-1/docs/doc-content-1');
    expect(openDocumentMock).not.toHaveBeenCalled();
  });

  it('defaults to Documents first in document mode and keeps Skills as the second tab', () => {
    useParamsMock.mockReturnValue({ docId: 'doc-content-1' });
    documentListMock.mockReturnValue(mixedDocumentListState());

    render(<AgentDocumentsGroup />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Documents',
      'Skills',
    ]);
    expect(screen.queryByText('Web')).not.toBeInTheDocument();

    const tree = screen.getByTestId('document-explorer-tree');
    expect(tree).toBeInTheDocument();
    expect(tree).toHaveAttribute('data-doc-count', '1');
    expect(screen.queryByTestId('skills-list')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Skills'));
    expect(screen.getByTestId('skills-list')).toBeInTheDocument();
  });

  it('can be controlled by an outer page-mode tab bar', () => {
    useParamsMock.mockReturnValue({ docId: 'doc-content-1' });
    documentListMock.mockReturnValue(mixedDocumentListState());

    const { rerender } = render(
      <AgentDocumentsGroup activeFilter="skills" showFilterTabs={false} />,
    );

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByTestId('skills-list')).toBeInTheDocument();
    expect(screen.queryByTestId('document-explorer-tree')).not.toBeInTheDocument();

    rerender(<AgentDocumentsGroup activeFilter="documents" showFilterTabs={false} />);

    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByTestId('document-explorer-tree')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-list')).not.toBeInTheDocument();
  });

  it('resets to Documents when entering document mode', () => {
    documentListMock.mockReturnValue(fileDocumentListState());

    const { rerender } = render(<AgentDocumentsGroup />);
    fireEvent.click(screen.getByText('Web'));
    expect(screen.getByText('Example')).toBeInTheDocument();

    useParamsMock.mockReturnValue({ docId: 'doc-content-1' });
    rerender(<AgentDocumentsGroup style={{ minHeight: 0 }} />);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Documents',
      'Skills',
    ]);
    expect(screen.getByTestId('document-explorer-tree')).toBeInTheDocument();
    expect(screen.queryByText('Example')).not.toBeInTheDocument();
  });

  it('renders web items as cards in the Web tab and supports deletion', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    documentListMock.mockReturnValue({
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
    expect(openDocumentMock).toHaveBeenCalledWith('doc-content-2', 'doc-2');
    expect(navigateMock).not.toHaveBeenCalled();
    openDocumentMock.mockClear();

    fireEvent.click(screen.getByLabelText('delete'));
    const [firstConfirmCall] = modalConfirm.mock.calls;
    const [{ onOk }] = firstConfirmCall;
    await onOk();

    expect(removeDocumentMock).toHaveBeenCalledWith({
      agentId: 'agent-1',
      documentId: 'doc-content-2',
      id: 'doc-2',
      withChildren: true,
    });
    expect(mutate).toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(openDocumentMock).not.toHaveBeenCalled();
    expect(messageSuccess).toHaveBeenCalledWith('workingPanel.resources.deleteSuccess');
  });

  it('falls back to a single empty placeholder when every skill source is empty', () => {
    documentListMock.mockReturnValue(fileDocumentListState());

    render(<AgentDocumentsGroup />);

    // No agent bundles, no working dir (no Project section), no user-installed
    // skills → renderSkills collapses to the shared "No skills found"
    // placeholder rather than rendering an empty section per source.
    expect(screen.getByText('No skills found')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-list')).not.toBeInTheDocument();
  });

  describe('skill search', () => {
    const search = (value: string) =>
      fireEvent.change(screen.getByLabelText('workingPanel.skills.searchPlaceholder'), {
        target: { value },
      });

    beforeEach(() => {
      documentListMock.mockReturnValue(skillDocumentListState());
    });

    it('filters skills and shows a no-match state while keeping the input', async () => {
      render(<AgentDocumentsGroup />);
      expect(screen.getByText('YouTube Comment Retrieval Workflow')).toBeInTheDocument();

      search('no-such-skill');
      await waitFor(() =>
        expect(screen.getByText('workingPanel.skills.noSearchResults')).toBeInTheDocument(),
      );
      expect(screen.queryByText('YouTube Comment Retrieval Workflow')).not.toBeInTheDocument();
      expect(screen.getByLabelText('workingPanel.skills.searchPlaceholder')).toHaveValue(
        'no-such-skill',
      );

      search('youtube');
      await waitFor(() =>
        expect(screen.getByText('YouTube Comment Retrieval Workflow')).toBeInTheDocument(),
      );
    });

    it.each([
      { canManage: false, documentMode: false },
      { canManage: false, documentMode: true },
      { canManage: true, documentMode: true },
      { canManage: true, documentMode: false },
    ])('reports no matching user skills exactly once: %j', async ({ canManage, documentMode }) => {
      documentListMock.mockReturnValue({ data: [] });
      userSkillInventory.items = [{ id: 'writing', name: 'Writing skill' }];
      userSkillInventory.enabledIds = ['writing'];
      userSkillInventory.canManage = canManage;
      useParamsMock.mockReturnValue(documentMode ? { docId: 'document' } : {});
      render(<AgentDocumentsGroup activeFilter="skills" />);

      expect(screen.getByText('Writing skill')).toBeInTheDocument();
      search('no-such-skill');
      await waitFor(() =>
        expect(screen.getAllByText('workingPanel.skills.noSearchResults')).toHaveLength(1),
      );
      expect(screen.queryByText('Writing skill')).not.toBeInTheDocument();
      if (!canManage || documentMode) {
        expect(
          screen.queryByRole('button', { name: 'Manage user skills' }),
        ).not.toBeInTheDocument();
      }

      search('');
      await waitFor(() => expect(screen.getByText('Writing skill')).toBeInTheDocument());
      expect(screen.queryByText('workingPanel.skills.noSearchResults')).not.toBeInTheDocument();
    });

    it('does not keep filtering after the search bar unmounts with the Skills tab', async () => {
      render(<AgentDocumentsGroup />);

      search('no-such-skill');
      await waitFor(() =>
        expect(screen.getByText('workingPanel.skills.noSearchResults')).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Skills' }));

      expect(screen.getByLabelText('workingPanel.skills.searchPlaceholder')).toHaveValue('');
      expect(screen.getByText('YouTube Comment Retrieval Workflow')).toBeInTheDocument();
    });

    it('hides the search bar when there are no skills at all', () => {
      documentListMock.mockReturnValue(singleFileListState());
      render(<AgentDocumentsGroup />);

      expect(
        screen.queryByLabelText('workingPanel.skills.searchPlaceholder'),
      ).not.toBeInTheDocument();
    });
  });

  it('shows the web empty state when no web items are present', () => {
    documentListMock.mockReturnValue(singleFileListState());

    render(<AgentDocumentsGroup />);
    fireEvent.click(screen.getByText('Web'));

    expect(screen.getByText('No agent documents yet')).toBeInTheDocument();
  });

  it('renders error state when the first load fails', () => {
    const mutate = vi.fn();
    documentListMock.mockReturnValue({
      data: undefined,
      error: new Error('oops'),
      isLoading: false,
      mutate,
    });

    render(<AgentDocumentsGroup />);

    fireEvent.click(screen.getByTestId('async-error'));
    expect(mutate).toHaveBeenCalled();
  });

  it('keeps painting the persisted list when its revalidation fails', () => {
    documentListMock.mockReturnValue({
      data: [fileDocRow, webDocRow],
      error: new Error('offline'),
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);
    fireEvent.click(screen.getByText('Web'));

    expect(screen.queryByTestId('async-error')).not.toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();
  });

  it('renders the loading spinner while data is being fetched', () => {
    documentListMock.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode as ReactNodeType, Ref } from 'react';
import { useImperativeHandle } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';
import { initialState } from '@/store/global/initialState';
import { useUserStore } from '@/store/user';

import Files from '../index';

// ─── shared mutable handle spies ──────────────────────────────────────────────

const handleSpies = {
  focus: vi.fn(),
  getSelectedIds: vi.fn((): string[] => []),
  resync: vi.fn(),
  select: vi.fn(),
  setExpanded: vi.fn(),
  startCreating: vi.fn(),
  startRenaming: vi.fn(),
};

const explorerTreeProps = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
}));
const gitFilesMock = vi.hoisted(() => ({
  data: {
    added: ['root.ts'],
    deleted: ['deleted.ts'],
    modified: ['src/foo/bar.ts'],
  },
}));
const openLocalFileMock = vi.hoisted(() => vi.fn());
const searchProjectFilesMock = vi.hoisted(() => vi.fn());
const listProjectDirectoryMock = vi.hoisted(() => vi.fn());
const fileOpsMock = vi.hoisted(() => ({
  copyProjectFiles: vi.fn(),
  createProjectDirectory: vi.fn(),
  createProjectFile: vi.fn(),
  moveProjectFiles: vi.fn(),
  refreshProjectFiles: vi.fn(),
  renameProjectFile: vi.fn(),
  trashProjectFiles: vi.fn(),
}));
const uiSpies = vi.hoisted(() => ({
  confirmModal: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
const projectFilesMock = vi.hoisted(() => {
  const baseEntries = [
    { isDirectory: true, name: 'src', path: '/repo/src', relativePath: 'src/' },
    { isDirectory: true, name: 'foo', path: '/repo/src/foo', relativePath: 'src/foo/' },
    {
      isDirectory: false,
      name: 'bar.ts',
      path: '/repo/src/foo/bar.ts',
      relativePath: 'src/foo/bar.ts',
    },
    { isDirectory: false, name: 'root.ts', path: '/repo/root.ts', relativePath: 'root.ts' },
    {
      isDirectory: false,
      name: '__project_root__',
      path: '/repo/__project_root__',
      relativePath: '__project_root__',
    },
    {
      gitIgnored: true,
      isDirectory: false,
      name: '.env.local',
      path: '/repo/.env.local',
      relativePath: '.env.local',
    },
    {
      gitIgnored: true,
      isDirectory: false,
      name: '.DS_Store',
      path: '/repo/.DS_Store',
      relativePath: '.DS_Store',
    },
    { isDirectory: false, name: 'draft.md~', path: '/repo/draft.md~', relativePath: 'draft.md~' },
    {
      gitIgnored: true,
      isDirectory: true,
      name: '.git',
      path: '/repo/.git',
      relativePath: '.git/',
    },
    {
      gitIgnored: true,
      isDirectory: false,
      name: 'config',
      path: '/repo/.git/config',
      relativePath: '.git/config',
    },
    {
      gitIgnored: true,
      isDirectory: true,
      name: 'node_modules',
      path: '/repo/node_modules',
      relativePath: 'node_modules/',
    },
    {
      gitIgnored: true,
      isDirectory: true,
      name: '.next',
      path: '/repo/.next',
      relativePath: '.next/',
    },
    {
      gitIgnored: true,
      isDirectory: true,
      name: 'dist',
      path: '/repo/dist',
      relativePath: 'dist/',
    },
    { isDirectory: true, name: 'build', path: '/repo/build', relativePath: 'build/' },
    { isDirectory: true, name: '.github', path: '/repo/.github', relativePath: '.github/' },
    { isDirectory: true, name: '.vscode', path: '/repo/.vscode', relativePath: '.vscode/' },
  ];

  return {
    baseEntries,
    data: {
      entries: [...baseEntries],
      indexedAt: '2026-01-01',
      root: '/repo',
      source: 'git' as 'git' | 'glob',
    },
  };
});

// ─── mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/features/ExplorerTree', () => {
  const MockExplorerTree = ({ ref, ...props }: { ref?: Ref<unknown>; [key: string]: unknown }) => {
    explorerTreeProps.current = props;
    useImperativeHandle(ref, () => ({
      focus: handleSpies.focus,
      getFocusedId: vi.fn(() => null),
      getSelectedIds: handleSpies.getSelectedIds,
      deselect: vi.fn(),
      resync: handleSpies.resync,
      select: handleSpies.select,
      setExpanded: handleSpies.setExpanded,
      startCreating: handleSpies.startCreating,
      startRenaming: handleSpies.startRenaming,
    }));
    return <div data-testid="explorer-tree" />;
  };
  MockExplorerTree.displayName = 'MockExplorerTree';
  return {
    ExplorerTree: MockExplorerTree,
    FOLDER_ICON_CSS: 'folder-css',
    HIDE_POINTER_FOCUS_RING_CSS: 'hide-pointer-focus-ring-css',
    getExplorerTreeStyleVars: () => ({}),
  };
});

vi.mock('../useGitWorkingTreeFiles', () => ({
  buildGitStatusEntries: (files?: { added: string[]; deleted: string[]; modified: string[] }) =>
    files
      ? [
          ...files.added.map((path) => ({ path, status: 'added' })),
          ...files.modified.map((path) => ({ path, status: 'modified' })),
          ...files.deleted.map((path) => ({ path, status: 'deleted' })),
        ]
      : [],
  useGitWorkingTreeFiles: () => ({ data: gitFilesMock.data }),
}));

vi.mock('../useProjectFiles', () => ({
  useProjectFiles: (_deviceId: string | undefined, workingDirectory: string) => ({
    data: {
      ...projectFilesMock.data,
      entries: projectFilesMock.data.entries,
      source: workingDirectory === '/non-git' ? 'glob' : projectFilesMock.data.source,
    },
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  }),
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: {
    copyProjectFiles: fileOpsMock.copyProjectFiles,
    createProjectDirectory: fileOpsMock.createProjectDirectory,
    createProjectFile: fileOpsMock.createProjectFile,
    listProjectDirectory: listProjectDirectoryMock,
    moveProjectFiles: fileOpsMock.moveProjectFiles,
    renameProjectFile: fileOpsMock.renameProjectFile,
    searchProjectFiles: searchProjectFilesMock,
    trashProjectFiles: fileOpsMock.trashProjectFiles,
  },
  refreshProjectFiles: fileOpsMock.refreshProjectFiles,
}));

vi.mock('@/utils/platform', () => ({
  getPlatform: () => 'Mac OS',
  isMacOS: () => true,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeAgentId: 'agt_1',
      activeTopicId: 'tpc_1',
      openLocalFile: openLocalFileMock,
    }),
}));

const messageSpy = vi.hoisted(() => ({ warning: vi.fn() }));

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  message: messageSpy,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  confirmModal: uiSpies.confirmModal,
  toast: { error: uiSpies.toastError, success: uiSpies.toastSuccess },
  ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
    <button title={title} type={'button'} onClick={onClick} />
  ),
  Button: ({ children, title }: { children?: ReactNodeType; title?: string }) => (
    <button title={title} type={'button'}>
      {children}
    </button>
  ),
  DropdownMenu: ({
    children,
    items,
  }: {
    children?: ReactNodeType;
    items: {
      key: string;
      label: ReactNodeType;
      onCheckedChange?: (checked: boolean) => void;
      onClick?: () => void;
    }[];
  }) => (
    <div>
      {children}
      {items.map((item) => (
        <button
          key={item.key}
          type={'button'}
          onClick={() => {
            item.onClick?.();
            item.onCheckedChange?.(true);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({ children }: { children?: ReactNodeType }) => <div>{children}</div>,
  copyToClipboard: vi.fn(),
  Empty: ({ description }: { description?: ReactNodeType }) => <div>{description}</div>,
  Flexbox: ({ children }: { children?: ReactNodeType }) => <div>{children}</div>,
  Icon: () => <span />,
  stopPropagation: vi.fn(),
}));

vi.mock('antd-style', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    createStaticStyles: () => () => ({}),
  };
});

// ─── helpers ──────────────────────────────────────────────────────────────────

const setReveal = (path: string, nonce: number) => {
  useGlobalStore.setState({
    status: {
      ...useGlobalStore.getState().status,
      workingSidebarRevealRequest: { nonce, path },
    },
  });
};

const expandSearch = () => {
  fireEvent.click(screen.getByTitle('workingPanel.files.search'));
};

// ─── tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  projectFilesMock.data.source = 'git';
  projectFilesMock.data.entries = [...projectFilesMock.baseEntries];
  explorerTreeProps.current = undefined;
  handleSpies.focus.mockClear();
  handleSpies.select.mockClear();
  handleSpies.setExpanded.mockClear();
  handleSpies.getSelectedIds.mockReset();
  handleSpies.getSelectedIds.mockReturnValue([]);
  handleSpies.resync.mockClear();
  handleSpies.startCreating.mockClear();
  handleSpies.startRenaming.mockClear();
  for (const mock of Object.values(fileOpsMock)) mock.mockReset();
  fileOpsMock.refreshProjectFiles.mockResolvedValue(undefined);
  uiSpies.confirmModal.mockReset();
  uiSpies.toastError.mockReset();
  uiSpies.toastSuccess.mockReset();
  messageSpy.warning.mockClear();
  openLocalFileMock.mockClear();
  listProjectDirectoryMock.mockReset();
  listProjectDirectoryMock.mockResolvedValue({ entries: [], truncated: false });
  // Default to an empty result so EVERY call resolves to a promise. The search
  // effect can fire more than once (debounce + effect re-run / StrictMode), and
  // per-test `mockResolvedValueOnce` only covers the first call — an extra,
  // un-mocked call would return `undefined`, and the component's
  // `searchProjectFiles(...).then(...)` would throw "reading 'then'" (flaky in CI).
  searchProjectFilesMock.mockReset();
  searchProjectFilesMock.mockResolvedValue({
    entries: [],
    root: '/repo',
    searchedAt: '2026-01-01',
    source: 'git',
  });
  useGlobalStore.setState({
    ...initialState,
    status: { ...initialState.status, workingSidebarRevealRequest: undefined },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Files — reveal request integration', () => {
  it('hides common workspace metadata and generated noise while preserving project configuration', () => {
    render(<Files workingDirectory="/repo" />);

    const nodeIds = (explorerTreeProps.current?.nodes as { id: string }[]).map((node) => node.id);

    expect(nodeIds).toEqual(
      expect.arrayContaining(['.env.local', '.github/', '.vscode/', 'build/']),
    );
    expect(nodeIds).toEqual(
      expect.not.arrayContaining([
        '.DS_Store',
        '.git/',
        '.git/config',
        'draft.md~',
        'node_modules/',
        '.next/',
        'dist/',
      ]),
    );
  });

  it('wraps every visible entry in a named project root folder', () => {
    render(<Files workingDirectory="/repo" />);

    const nodes = explorerTreeProps.current?.nodes as {
      id: string;
      name: string;
      parentId: string | null;
    }[];

    expect(nodes[0]).toMatchObject({
      id: '\0project-root',
      name: 'repo',
      parentId: null,
    });
    expect(nodes.find((node) => node.id === 'src/')).toMatchObject({
      parentId: '\0project-root',
    });
    expect(nodes.find((node) => node.id === 'root.ts')).toMatchObject({
      parentId: '\0project-root',
    });
    expect(nodes.find((node) => node.id === '__project_root__')).toMatchObject({
      name: '__project_root__',
      parentId: '\0project-root',
    });
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
    expect(explorerTreeProps.current?.defaultExpandedIds).toContain('\0project-root');
  });

  it('switches from the project view to a Git changes view', () => {
    render(<Files workingDirectory="/repo" />);

    fireEvent.click(screen.getByText('workingPanel.files.views.changes'));

    expect((explorerTreeProps.current?.nodes as { id: string }[]).map((node) => node.id)).toEqual([
      '\0project-root',
      'src/',
      'src/foo/',
      'src/foo/bar.ts',
      'root.ts',
      'deleted.ts',
    ]);
  });

  it('sends active Git and ignore filters to the file host before search truncation', async () => {
    render(<Files workingDirectory="/repo" />);

    fireEvent.click(screen.getByText('workingPanel.files.views.changes'));
    fireEvent.click(screen.getByTitle('workingPanel.files.filters.title'));
    fireEvent.click(screen.getByText('workingPanel.files.filters.hideIgnored'));
    expandSearch();
    fireEvent.change(screen.getByPlaceholderText('workingPanel.files.searchPlaceholder'), {
      target: { value: 'bar' },
    });

    await waitFor(() => {
      expect(searchProjectFilesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeIgnored: true,
          changedOnly: true,
          limit: 200,
          query: 'bar',
        }),
      );
    });
  });

  it('resets the Git changes view when the workspace changes or is not Git-backed', async () => {
    const { rerender } = render(<Files workingDirectory="/repo" />);

    fireEvent.click(screen.getByText('workingPanel.files.views.changes'));
    expect(
      (explorerTreeProps.current?.nodes as { id: string }[]).map((node) => node.id),
    ).not.toContain('.env.local');

    rerender(<Files workingDirectory="/another-repo" />);
    await waitFor(() => {
      expect(
        (explorerTreeProps.current?.nodes as { id: string }[]).map((node) => node.id),
      ).toContain('.env.local');
    });

    fireEvent.click(screen.getByText('workingPanel.files.views.changes'));
    rerender(<Files workingDirectory="/non-git" />);
    await waitFor(() => {
      expect(
        (explorerTreeProps.current?.nodes as { id: string }[]).map((node) => node.id),
      ).toContain('.env.local');
    });
  });

  it('passes git working tree status and per-item context menu items into ExplorerTree', () => {
    render(<Files workingDirectory="/repo" />);

    expect(explorerTreeProps.current?.gitStatus).toEqual([
      { path: 'repo/.env.local', status: 'ignored' },
      { path: 'repo/root.ts', status: 'added' },
      { path: 'repo/src/foo/bar.ts', status: 'modified' },
      { path: 'repo/deleted.ts', status: 'deleted' },
    ]);
    expect(explorerTreeProps.current?.unsafeCSS).toContain(
      "[data-item-git-status='ignored'] > :where(",
    );
    expect(explorerTreeProps.current?.unsafeCSS).toContain('opacity: 0.7');

    const nodes = explorerTreeProps.current?.nodes as { id: string }[];
    const dirtyNode = nodes.find((node) => node.id === 'src/foo/bar.ts');
    const ignoredNode = nodes.find((node) => node.id === '.env.local');
    const cleanFolderNode = nodes.find((node) => node.id === 'src/');

    const getContextMenuItems = explorerTreeProps.current?.getContextMenuItems as (
      node: unknown,
    ) => { key: string }[];

    expect(getContextMenuItems(dirtyNode).map((item) => item.key)).toEqual([
      'open',
      'divider-show-in-system',
      'show-in-system',
      'show-in-review',
      'divider-cut',
      'cut',
      'copy',
      'paste',
      'duplicate',
      'divider-copy-absolute-path',
      'copy-absolute-path',
      'copy-relative-path',
      'divider-rename',
      'rename',
      'trash',
    ]);
    expect(getContextMenuItems(cleanFolderNode).map((item) => item.key)).toEqual([
      'new-file',
      'new-folder',
      'divider-open-in-system',
      'open-in-system',
      'show-in-system',
      'divider-cut',
      'cut',
      'copy',
      'paste',
      'duplicate',
      'divider-copy-absolute-path',
      'copy-absolute-path',
      'copy-relative-path',
      'divider-rename',
      'rename',
      'trash',
    ]);
    expect(getContextMenuItems(ignoredNode).map((item) => item.key)).not.toContain(
      'show-in-review',
    );
  });

  it('keeps create and refresh inside the trailing "…" menu', async () => {
    render(<Files workingDirectory="/repo" />);

    // Neither "New" nor refresh is its own header button; both sit in "…".
    expect(screen.queryByTitle('workingPanel.files.actions.refresh')).toBeNull();
    expect(screen.queryByTitle('workingPanel.files.actions.new')).toBeNull();
    const more = screen.getByTitle('workingPanel.files.actions.more').parentElement!;
    expect(within(more).getByText('workingPanel.files.actions.newFile')).toBeTruthy();
    expect(within(more).getByText('workingPanel.files.actions.newFolder')).toBeTruthy();
    expect(within(more).getByText('workingPanel.files.actions.refresh')).toBeTruthy();

    fireEvent.click(screen.getByText('workingPanel.files.actions.refresh'));
    await waitFor(() =>
      expect(fileOpsMock.refreshProjectFiles).toHaveBeenCalledWith(undefined, '/repo'),
    );

    fireEvent.click(screen.getByText('workingPanel.files.actions.newFolder'));
    expect(handleSpies.startCreating).toHaveBeenCalledWith('\0project-root', 'folder');
  });

  it('hands every tree operation to ExplorerTree', () => {
    render(<Files workingDirectory="/repo" />);
    for (const prop of [
      'canDrag',
      'canDrop',
      'canRename',
      'getBlankContextMenuItems',
      'onCommitCreate',
      'onCommitRename',
      'onMove',
      'onTreeKeyDown',
      'validateName',
    ]) {
      expect(explorerTreeProps.current?.[prop]).toBeTypeOf('function');
    }
  });

  it('does not offer a publish action in the open-source build', () => {
    const previousLab = useUserStore.getState().preference.lab;
    useUserStore.setState({
      preference: {
        ...useUserStore.getState().preference,
        lab: { ...previousLab, enableArtifactDeployment: true },
      },
    });

    try {
      render(<Files workingDirectory="/repo" />);

      const getContextMenuItems = explorerTreeProps.current?.getContextMenuItems as (
        node: unknown,
      ) => { key: string }[];

      expect(
        getContextMenuItems({
          data: {
            isDirectory: false,
            name: 'index.html',
            path: '/repo/index.html',
            relativePath: 'index.html',
          },
          id: 'index.html',
          isFolder: false,
        }).map((item) => item.key),
      ).not.toContain('publish');
    } finally {
      useUserStore.setState({
        preference: {
          ...useUserStore.getState().preference,
          lab: previousLab,
        },
      });
    }
  });

  it('opens file previews with the indexed project root as the approved workspace root', () => {
    render(<Files workingDirectory="/repo/packages/app" />);

    const nodes = explorerTreeProps.current?.nodes as {
      data: { path: string };
      id: string;
      isFolder: boolean;
    }[];
    const rootFileNode = nodes.find((node) => node.id === 'root.ts');
    const getContextMenuItems = explorerTreeProps.current?.getContextMenuItems as (
      node: unknown,
    ) => Array<{ key: string; onClick?: () => void }>;

    getContextMenuItems(rootFileNode)
      .find((item) => item.key === 'open')
      ?.onClick?.();

    expect(openLocalFileMock).toHaveBeenCalledWith({
      filePath: '/repo/root.ts',
      workingDirectory: '/repo',
    });
  });

  it('filters file tree nodes while retaining ancestor directories', async () => {
    searchProjectFilesMock.mockResolvedValue({
      entries: [
        { isDirectory: true, name: 'src', path: '/repo/src', relativePath: 'src/' },
        { isDirectory: true, name: 'foo', path: '/repo/src/foo', relativePath: 'src/foo/' },
        {
          isDirectory: false,
          name: 'bar.ts',
          path: '/repo/src/foo/bar.ts',
          relativePath: 'src/foo/bar.ts',
        },
      ],
      root: '/repo',
      searchedAt: '2026-01-01',
      source: 'git',
    });
    render(<Files workingDirectory="/repo" />);

    expandSearch();
    fireEvent.change(screen.getByPlaceholderText('workingPanel.files.searchPlaceholder'), {
      target: { value: 'bar' },
    });

    await waitFor(() => {
      expect(searchProjectFilesMock).toHaveBeenCalledWith({
        deviceId: undefined,
        excludeIgnored: false,
        changedOnly: false,
        limit: 200,
        query: 'bar',
        scope: '/repo',
      });
      expect((explorerTreeProps.current?.nodes as { id: string }[]).map((node) => node.id)).toEqual(
        ['\0project-root', 'src/', 'src/foo/', 'src/foo/bar.ts'],
      );
    });
  });

  it('keeps excluded workspace metadata out of file search results', async () => {
    searchProjectFilesMock.mockResolvedValue({
      entries: [
        { isDirectory: true, name: '.git', path: '/repo/.git', relativePath: '.git/' },
        {
          isDirectory: false,
          name: 'config',
          path: '/repo/.git/config',
          relativePath: '.git/config',
        },
        { isDirectory: true, name: '.github', path: '/repo/.github', relativePath: '.github/' },
        {
          isDirectory: false,
          name: 'ci.yml',
          path: '/repo/.github/ci.yml',
          relativePath: '.github/ci.yml',
        },
      ],
      root: '/repo',
      searchedAt: '2026-01-01',
      source: 'git',
    });
    render(<Files workingDirectory="/repo" />);

    expandSearch();
    fireEvent.change(screen.getByPlaceholderText('workingPanel.files.searchPlaceholder'), {
      target: { value: 'git' },
    });

    await waitFor(() => {
      expect((explorerTreeProps.current?.nodes as { id: string }[]).map((node) => node.id)).toEqual(
        ['\0project-root', '.github/', '.github/ci.yml'],
      );
    });
  });

  it('shows a no-results state when the file filter has no matches', async () => {
    searchProjectFilesMock.mockResolvedValue({
      entries: [],
      root: '/repo',
      searchedAt: '2026-01-01',
      source: 'git',
    });
    render(<Files workingDirectory="/repo" />);

    expandSearch();
    fireEvent.change(screen.getByPlaceholderText('workingPanel.files.searchPlaceholder'), {
      target: { value: 'missing' },
    });

    expect(await screen.findByText('workingPanel.files.noSearchResults')).toBeInTheDocument();
  });

  it('(a) reveals existing path: calls setExpanded with ancestors, then select and focus', async () => {
    render(<Files workingDirectory="/repo" />);

    setReveal('src/foo/bar.ts', 1);

    await vi.waitFor(() => {
      expect(handleSpies.setExpanded).toHaveBeenCalled();
    });

    const expandedArg: string[] = handleSpies.setExpanded.mock.calls[0][0];
    expect(expandedArg).toContain('src/');
    expect(expandedArg).toContain('src/foo/');

    expect(handleSpies.select).toHaveBeenCalledWith('src/foo/bar.ts');
    expect(handleSpies.focus).toHaveBeenCalledWith('src/foo/bar.ts');
    expect(messageSpy.warning).not.toHaveBeenCalled();
  });

  it('(a-root) reveals root-level file: no ancestor dirs, only select+focus', async () => {
    render(<Files workingDirectory="/repo" />);

    setReveal('root.ts', 1);

    await vi.waitFor(() => {
      expect(handleSpies.select).toHaveBeenCalledWith('root.ts');
    });

    expect(handleSpies.focus).toHaveBeenCalledWith('root.ts');
    // root.ts has no ancestor dirs; setExpanded is still called but must not include 'root.ts'
    expect(handleSpies.setExpanded).toHaveBeenCalled();
    const expandedArg: string[] = handleSpies.setExpanded.mock.calls[0][0];
    expect(expandedArg).not.toContain('root.ts');
    expect(messageSpy.warning).not.toHaveBeenCalled();
  });

  it('(b) missing path is a silent no-op', async () => {
    render(<Files workingDirectory="/repo" />);

    setReveal('nonexistent/deep/file.ts', 1);

    // Give the effect a tick to run so we can assert nothing happened.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messageSpy.warning).not.toHaveBeenCalled();
    expect(handleSpies.setExpanded).not.toHaveBeenCalled();
    expect(handleSpies.select).not.toHaveBeenCalled();
    expect(handleSpies.focus).not.toHaveBeenCalled();
  });

  it('(c) bumping nonce with same path retriggers reveal', async () => {
    render(<Files workingDirectory="/repo" />);

    setReveal('src/foo/bar.ts', 1);
    await vi.waitFor(() => {
      expect(handleSpies.select).toHaveBeenCalledTimes(1);
    });

    handleSpies.select.mockClear();
    handleSpies.focus.mockClear();
    handleSpies.setExpanded.mockClear();

    // Same path, new nonce → should fire again
    setReveal('src/foo/bar.ts', 2);
    await vi.waitFor(() => {
      expect(handleSpies.select).toHaveBeenCalledTimes(1);
    });

    expect(handleSpies.focus).toHaveBeenCalledWith('src/foo/bar.ts');
    expect(handleSpies.setExpanded).toHaveBeenCalled();
  });

  it('no-op when revealRequest is null/undefined (initial state)', () => {
    // revealRequest is already undefined from beforeEach
    render(<Files workingDirectory="/repo" />);

    expect(handleSpies.setExpanded).not.toHaveBeenCalled();
    expect(handleSpies.select).not.toHaveBeenCalled();
    expect(handleSpies.focus).not.toHaveBeenCalled();
    expect(messageSpy.warning).not.toHaveBeenCalled();
  });
});

describe('Files — collapsed ignored directories', () => {
  const collapsedDirEntry = {
    collapsed: true,
    gitIgnored: true,
    isDirectory: true,
    name: '.agent-tracing',
    path: '/repo/.agent-tracing',
    relativePath: '.agent-tracing/',
  };

  const collapsedChildren = [
    {
      collapsed: true,
      gitIgnored: true,
      isDirectory: true,
      name: 'runs',
      path: '/repo/.agent-tracing/runs',
      relativePath: '.agent-tracing/runs/',
    },
    {
      gitIgnored: true,
      isDirectory: false,
      name: 'trace.jsonl',
      path: '/repo/.agent-tracing/trace.jsonl',
      relativePath: '.agent-tracing/trace.jsonl',
    },
  ];

  const expandNodes = (ids: string[]) => {
    const onExpandedChange = explorerTreeProps.current?.onExpandedChange as (ids: string[]) => void;
    act(() => onExpandedChange(ids));
  };

  it('fetches and renders children when a collapsed ignored directory is expanded', async () => {
    projectFilesMock.data.entries.push(collapsedDirEntry);
    listProjectDirectoryMock.mockResolvedValue({ entries: collapsedChildren, truncated: false });
    render(<Files workingDirectory="/repo" />);

    expandNodes(['\0project-root', '.agent-tracing/']);

    await waitFor(() => {
      expect(listProjectDirectoryMock).toHaveBeenCalledWith({
        deviceId: undefined,
        relativePath: '.agent-tracing/',
        root: '/repo',
      });
      const nodes = explorerTreeProps.current?.nodes as { id: string; parentId: string | null }[];
      expect(nodes.find((node) => node.id === '.agent-tracing/trace.jsonl')?.parentId).toBe(
        '.agent-tracing/',
      );
      expect(nodes.find((node) => node.id === '.agent-tracing/runs/')?.parentId).toBe(
        '.agent-tracing/',
      );
    });
  });

  it('routes the fetch through the device RPC when a remote device is bound', async () => {
    projectFilesMock.data.entries.push(collapsedDirEntry);
    render(<Files deviceId="dev_1" workingDirectory="/repo" />);

    expandNodes(['\0project-root', '.agent-tracing/']);

    await waitFor(() => {
      expect(listProjectDirectoryMock).toHaveBeenCalledWith({
        deviceId: 'dev_1',
        relativePath: '.agent-tracing/',
        root: '/repo',
      });
    });
  });

  it('keeps expanding nested collapsed directories fetched from disk', async () => {
    projectFilesMock.data.entries.push(collapsedDirEntry);
    listProjectDirectoryMock.mockImplementation(({ relativePath }: { relativePath: string }) =>
      Promise.resolve(
        relativePath === '.agent-tracing/'
          ? { entries: collapsedChildren, truncated: false }
          : {
              entries: [
                {
                  gitIgnored: true,
                  isDirectory: false,
                  name: 'run-1.json',
                  path: '/repo/.agent-tracing/runs/run-1.json',
                  relativePath: '.agent-tracing/runs/run-1.json',
                },
              ],
              truncated: false,
            },
      ),
    );
    render(<Files workingDirectory="/repo" />);

    expandNodes(['\0project-root', '.agent-tracing/']);
    await waitFor(() => {
      expect(
        (explorerTreeProps.current?.nodes as { id: string }[]).some(
          (node) => node.id === '.agent-tracing/runs/',
        ),
      ).toBe(true);
    });

    expandNodes(['\0project-root', '.agent-tracing/', '.agent-tracing/runs/']);

    await waitFor(() => {
      expect(listProjectDirectoryMock).toHaveBeenCalledWith({
        deviceId: undefined,
        relativePath: '.agent-tracing/runs/',
        root: '/repo',
      });
      expect(
        (explorerTreeProps.current?.nodes as { id: string }[]).some(
          (node) => node.id === '.agent-tracing/runs/run-1.json',
        ),
      ).toBe(true);
    });
  });

  it('does not fetch directories the index already expanded, and fetches once per row', async () => {
    projectFilesMock.data.entries.push(collapsedDirEntry);
    render(<Files workingDirectory="/repo" />);

    expandNodes(['\0project-root', 'src/']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listProjectDirectoryMock).not.toHaveBeenCalled();

    expandNodes(['\0project-root', 'src/', '.agent-tracing/']);
    expandNodes(['\0project-root', '.agent-tracing/']);

    await waitFor(() => {
      expect(listProjectDirectoryMock).toHaveBeenCalledTimes(1);
    });
  });

  it('retries the listing on re-expand when the file host answered nothing (offline)', async () => {
    projectFilesMock.data.entries.push(collapsedDirEntry);
    listProjectDirectoryMock.mockResolvedValue(undefined);
    render(<Files workingDirectory="/repo" />);

    expandNodes(['\0project-root', '.agent-tracing/']);
    await waitFor(() => {
      expect(listProjectDirectoryMock).toHaveBeenCalledTimes(1);
    });
    expect(
      (explorerTreeProps.current?.nodes as { id: string }[]).some(
        (node) => node.id.startsWith('.agent-tracing/') && node.id !== '.agent-tracing/',
      ),
    ).toBe(false);

    // Collapse and re-expand after the device comes back: must retry.
    listProjectDirectoryMock.mockResolvedValue({ entries: collapsedChildren, truncated: false });
    expandNodes(['\0project-root']);
    expandNodes(['\0project-root', '.agent-tracing/']);

    await waitFor(() => {
      expect(listProjectDirectoryMock).toHaveBeenCalledTimes(2);
      expect(
        (explorerTreeProps.current?.nodes as { id: string }[]).some(
          (node) => node.id === '.agent-tracing/trace.jsonl',
        ),
      ).toBe(true);
    });
  });

  it('surfaces a truncation notice when the host caps the directory listing', async () => {
    projectFilesMock.data.entries.push(collapsedDirEntry);
    listProjectDirectoryMock.mockResolvedValue({ entries: collapsedChildren, truncated: true });
    render(<Files workingDirectory="/repo" />);

    expandNodes(['\0project-root', '.agent-tracing/']);

    await waitFor(() => {
      expect(screen.getByText('workingPanel.files.truncatedNotice')).toBeInTheDocument();
    });
  });
});

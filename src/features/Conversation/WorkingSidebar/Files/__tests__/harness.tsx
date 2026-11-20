// Shared mocks and fixtures for the Files pane suites. Import this module before
// `../index` so the module mocks are registered before the pane loads.

import { fireEvent, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode as ReactNodeType, Ref } from 'react';
import { useImperativeHandle } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';

import { useGlobalStore } from '@/store/global';
import { initialState } from '@/store/global/initialState';

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
  error: undefined as Error | undefined,
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
      persistedPartial: undefined as true | undefined,
      root: '/repo',
      source: 'git' as 'git' | 'glob',
    },
    error: undefined as Error | undefined,
    isValidating: false,
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
  useGitWorkingTreeFiles: () => ({ data: gitFilesMock.data, error: gitFilesMock.error }),
}));

vi.mock('../useProjectFiles', () => ({
  useProjectFiles: (_deviceId: string | undefined, workingDirectory: string) => ({
    data: {
      ...projectFilesMock.data,
      entries: projectFilesMock.data.entries,
      source: workingDirectory === '/non-git' ? 'glob' : projectFilesMock.data.source,
    },
    isLoading: false,
    error: projectFilesMock.error,
    isValidating: projectFilesMock.isValidating,
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

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const factories: ((original: typeof importOriginal) => unknown)[] = [
    async (importOriginal) => ({
      ...((await importOriginal()) as Record<string, unknown>),
      confirmModal: uiSpies.confirmModal,
      toast: { error: uiSpies.toastError, success: uiSpies.toastSuccess },
      ActionIcon: ({
        'aria-pressed': pressed,
        disabled,
        onClick,
        title,
      }: ComponentProps<'button'>) => (
        <button
          aria-pressed={pressed}
          disabled={disabled}
          title={title}
          type={'button'}
          onClick={onClick}
        />
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
    }),
    () => ({
      Center: ({ children }: { children?: ReactNodeType }) => <div>{children}</div>,
      copyToClipboard: vi.fn(),
      Empty: ({ description }: { description?: ReactNodeType }) => <div>{description}</div>,
      Flexbox: ({ children }: { children?: ReactNodeType }) => <div>{children}</div>,
      Icon: () => <span />,
      stopPropagation: vi.fn(),
    }),
    async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>;

      return {
        ...actual,
        createStaticStyles: () => () => ({}),
      };
    },
  ];
  const merged: Record<string, unknown> = { ...actual };
  for (const factory of factories) {
    const part = (await factory(importOriginal)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(part)) if (value !== actual[key]) merged[key] = value;
  }
  return merged;
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
  projectFilesMock.data.persistedPartial = undefined;
  projectFilesMock.error = undefined;
  projectFilesMock.isValidating = false;
  gitFilesMock.error = undefined;
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

export {
  expandSearch,
  explorerTreeProps,
  fileOpsMock,
  gitFilesMock,
  handleSpies,
  listProjectDirectoryMock,
  messageSpy,
  openLocalFileMock,
  projectFilesMock,
  searchProjectFilesMock,
  setReveal,
  uiSpies,
};

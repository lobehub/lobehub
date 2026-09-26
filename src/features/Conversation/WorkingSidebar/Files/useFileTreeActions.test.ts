import { WORKSPACE_FILE_DRAG_MIME } from '@lobechat/const';
import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExplorerTreeHandle, ExplorerTreeNode } from '@/features/ExplorerTree';
import { useGlobalStore } from '@/store/global';

import { useFileClipboardStore } from './fileClipboard';
import { PROJECT_ROOT_NODE_ID } from './treePaths';
import { useFileTreeActions } from './useFileTreeActions';

const service = vi.hoisted(() => ({
  copyProjectFiles: vi.fn(),
  createProjectDirectory: vi.fn(),
  createProjectFile: vi.fn(),
  moveProjectFiles: vi.fn(),
  refreshProjectFiles: vi.fn(),
  renameProjectFile: vi.fn(),
  trashProjectFiles: vi.fn(),
}));
const ui = vi.hoisted(() => ({ confirmModal: vi.fn(), error: vi.fn(), success: vi.fn() }));
const openLocalFile = vi.hoisted(() => vi.fn());
const retargetLocalFiles = vi.hoisted(() => vi.fn());
const closeLocalFilesAt = vi.hoisted(() => vi.fn());
const terminal = vi.hoisted(() => ({
  createErrors: {} as Record<string, string | undefined>,
  createTab: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDesktop: true,
}));

vi.mock('@/services/projectFile', () => ({
  projectFileService: service,
  refreshProjectFiles: service.refreshProjectFiles,
}));

vi.mock('@/features/ChatTerminal/store', () => ({
  useChatTerminalStore: { getState: () => terminal },
}));

vi.mock('@/utils/platform', () => ({ getPlatform: () => 'Mac OS', isMacOS: () => true }));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeAgentId: 'agt_1',
      activeTopicId: 'tpc_1',
      closeLocalFilesAt,
      openLocalFile,
      retargetLocalFiles,
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: ui.confirmModal,
  toast: { error: ui.error, success: ui.success },
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  copyToClipboard: vi.fn(),
}));

// ─── fixtures ─────────────────────────────────────────────────────────────────

type Node = ExplorerTreeNode<ProjectFileIndexEntry>;

const entry = (relativePath: string): ProjectFileIndexEntry => {
  const isDirectory = relativePath.endsWith('/');
  const clean = isDirectory ? relativePath.slice(0, -1) : relativePath;
  return {
    isDirectory,
    name: clean.split('/').pop()!,
    path: `/repo/${clean}`,
    relativePath,
  };
};

const baseEntries = ['src/', 'src/app.ts', 'root.ts'].map(entry);

const toNodes = (entries: ProjectFileIndexEntry[]): Node[] => [
  { id: PROJECT_ROOT_NODE_ID, isFolder: true, name: 'repo', parentId: null },
  ...entries.map((item) => {
    const parent = item.relativePath.replace(/[^/]+\/?$/, '');
    return {
      data: item,
      id: item.relativePath,
      isFolder: item.isDirectory,
      name: item.name,
      parentId: parent || PROJECT_ROOT_NODE_ID,
    };
  }),
];

const handle = {
  deselect: vi.fn(),
  focus: vi.fn(),
  getFocusedId: vi.fn(() => null),
  getSelectedIds: vi.fn((): string[] => []),
  resync: vi.fn(),
  select: vi.fn(),
  setExpanded: vi.fn(),
  startCreating: vi.fn(),
  startRenaming: vi.fn(),
} satisfies ExplorerTreeHandle;

const setup = (overrides: Partial<Parameters<typeof useFileTreeActions>[0]> = {}) => {
  const entries = [...baseEntries, entry('gone.ts')];
  const params: Parameters<typeof useFileTreeActions>[0] = {
    deletedPaths: new Set(['gone.ts']),
    dirtyFilePaths: new Set(['src/app.ts']),
    expandedIds: [PROJECT_ROOT_NODE_ID],
    hasDisplayFilter: false,
    invalidateCollapsedChildren: vi.fn(),
    knownEntries: baseEntries,
    nodes: toNodes(entries),
    onClearDisplayFilter: vi.fn(),
    onCollapseAll: vi.fn(),
    projectRoot: '/repo',
    treeRef: { current: handle },
    workingDirectory: '/repo',
    ...overrides,
  };
  const view = renderHook((props) => useFileTreeActions(props), { initialProps: params });
  const node = (id: string) => params.nodes.find((item) => item.id === id)!;
  const menu = (id: string) =>
    view.result.current.getContextMenuItems(node(id)) as {
      disabled?: boolean;
      key: string;
      onClick?: () => void;
    }[];
  const clickMenu = (id: string, key: string) =>
    act(() => menu(id).find((item) => item.key === key)!.onClick!());
  return { clickMenu, menu, node, params, view };
};

const keyEvent = (key: string, mods: Record<string, boolean> = {}) =>
  ({ altKey: false, ctrlKey: false, key, metaKey: false, shiftKey: false, ...mods }) as never;

beforeEach(() => {
  for (const mock of Object.values(service)) mock.mockReset();
  service.refreshProjectFiles.mockResolvedValue(undefined);
  for (const mock of Object.values(handle)) mock.mockReset();
  handle.getSelectedIds.mockReturnValue([]);
  ui.confirmModal.mockReset();
  ui.error.mockReset();
  ui.success.mockReset();
  openLocalFile.mockReset();
  retargetLocalFiles.mockReset();
  closeLocalFilesAt.mockReset();
  terminal.createTab.mockReset();
  terminal.createErrors = {};
  useFileClipboardStore.setState({ clipboard: undefined });
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useFileTreeActions — create', () => {
  it('creates a file under the target folder, invalidates lazy listings and refreshes', async () => {
    service.createProjectFile.mockResolvedValue({ path: '/repo/src/new.ts', success: true });
    const { node, params, view } = setup();

    await act(() =>
      view.result.current.onCommitCreate({
        kind: 'file',
        name: 'new.ts',
        parentNode: node('src/'),
      }),
    );

    expect(service.createProjectFile).toHaveBeenCalledWith({
      deviceId: undefined,
      path: '/repo/src/new.ts',
      workingDirectory: '/repo',
    });
    expect(params.invalidateCollapsedChildren).toHaveBeenCalledTimes(1);
    expect(service.refreshProjectFiles).toHaveBeenCalledWith(undefined, '/repo');
  });

  it('selects, reveals and opens the new file once the refreshed nodes contain it', async () => {
    service.createProjectFile.mockResolvedValue({ path: '/repo/src/new.ts', success: true });
    const { node, params, view } = setup();

    await act(() =>
      view.result.current.onCommitCreate({
        kind: 'file',
        name: 'new.ts',
        parentNode: node('src/'),
      }),
    );
    expect(openLocalFile).not.toHaveBeenCalled();

    handle.getSelectedIds.mockReturnValue(['src/app.ts']);
    view.rerender({ ...params, nodes: toNodes([...baseEntries, entry('src/new.ts')]) });

    expect(handle.setExpanded).toHaveBeenCalledWith([PROJECT_ROOT_NODE_ID, 'src/']);
    // The previous selection is replaced, not extended.
    expect(handle.deselect).toHaveBeenCalledWith('src/app.ts');
    expect(handle.select).toHaveBeenCalledWith('src/new.ts');
    expect(handle.focus).toHaveBeenCalledWith('src/new.ts');
    expect(openLocalFile).toHaveBeenCalledWith({
      deviceId: undefined,
      filePath: '/repo/src/new.ts',
      workingDirectory: '/repo',
    });
  });

  it('creates a folder through the device RPC on a remote device and expands it', async () => {
    service.createProjectDirectory.mockResolvedValue({ path: '/repo/docs', success: true });
    const { node, params, view } = setup({ deviceId: 'dev_1' });

    await act(() =>
      view.result.current.onCommitCreate({
        kind: 'folder',
        name: 'docs',
        parentNode: node(PROJECT_ROOT_NODE_ID),
      }),
    );
    expect(service.createProjectDirectory).toHaveBeenCalledWith({
      deviceId: 'dev_1',
      path: '/repo/docs',
      workingDirectory: '/repo',
    });
    expect(service.refreshProjectFiles).toHaveBeenCalledWith('dev_1', '/repo');

    view.rerender({ ...params, nodes: toNodes([...baseEntries, entry('docs/')]) });
    expect(handle.setExpanded).toHaveBeenCalledWith([PROJECT_ROOT_NODE_ID, 'docs/']);
    expect(openLocalFile).not.toHaveBeenCalled();
  });

  it('reports a failed create with its reason, refreshes and tells the tree to roll back', async () => {
    service.createProjectFile.mockResolvedValue({ error: 'EACCES', path: '', success: false });
    const { node, view } = setup();

    let result: unknown;
    await act(async () => {
      result = await view.result.current.onCommitCreate({
        kind: 'file',
        name: 'x.ts',
        parentNode: node(PROJECT_ROOT_NODE_ID),
      });
    });

    expect(result).toBe(false);
    expect(ui.error).toHaveBeenCalledWith(
      'workingPanel.files.feedback.createFailed {"name":"x.ts","reason":"EACCES"}',
    );
    expect(service.refreshProjectFiles).toHaveBeenCalledTimes(1);
  });

  it('opens the inline input from the folder menu, the blank area and the header', () => {
    const { clickMenu, view } = setup();

    clickMenu('src/', 'new-file');
    expect(handle.startCreating).toHaveBeenLastCalledWith('src/', 'file');

    const blankItems = view.result.current.getBlankContextMenuItems() as {
      key: string;
      onClick: () => void;
    }[];
    act(() => blankItems.find((item) => item.key === 'new-folder')!.onClick());
    expect(handle.startCreating).toHaveBeenLastCalledWith(PROJECT_ROOT_NODE_ID, 'folder');

    handle.getSelectedIds.mockReturnValue(['src/app.ts']);
    act(() => view.result.current.startCreateFromHeader('file'));
    expect(handle.startCreating).toHaveBeenLastCalledWith('src/', 'file');

    handle.getSelectedIds.mockReturnValue([]);
    act(() => view.result.current.startCreateFromHeader('folder'));
    expect(handle.startCreating).toHaveBeenLastCalledWith(PROJECT_ROOT_NODE_ID, 'folder');
  });

  it('drops display filters first and opens the input once the tree is unfiltered', async () => {
    const { clickMenu, params, view } = setup({ hasDisplayFilter: true });

    clickMenu('src/', 'new-folder');
    expect(params.onClearDisplayFilter).toHaveBeenCalledTimes(1);
    expect(handle.startCreating).not.toHaveBeenCalled();
    expect(view.result.current.pendingCreate).toBe(true);

    view.rerender({ ...params, hasDisplayFilter: false });
    await waitFor(() => expect(handle.startCreating).toHaveBeenCalledWith('src/', 'folder'));
  });
});

describe('useFileTreeActions — name validation', () => {
  it('flags empty, invalid and taken names (case-insensitive on macOS)', () => {
    const { node, view } = setup();
    const validate = (name: string, parent = PROJECT_ROOT_NODE_ID) =>
      view.result.current.validateName({
        kind: 'file',
        mode: 'create',
        name,
        parentNode: node(parent),
      });

    expect(validate('fresh.ts')).toBeNull();
    expect(validate(' ')).toBe('workingPanel.files.validation.empty {"name":" "}');
    expect(validate('a:b')).toContain('workingPanel.files.validation.invalidChars');
    expect(validate('ROOT.ts')).toContain('workingPanel.files.validation.exists');
    expect(validate('app.ts', 'src/')).toContain('workingPanel.files.validation.exists');
    expect(validate('src/app2.ts')).toBeNull();
  });

  it('compares case-sensitively on a remote device', () => {
    const { node, view } = setup({ deviceId: 'dev_1' });
    expect(
      view.result.current.validateName({
        kind: 'file',
        mode: 'create',
        name: 'ROOT.ts',
        parentNode: node(PROJECT_ROOT_NODE_ID),
      }),
    ).toBeNull();
  });

  it('refuses a slash in a rename but accepts the current name', () => {
    const { node, view } = setup();
    const validate = (name: string) =>
      view.result.current.validateName({ mode: 'rename', name, node: node('root.ts') });

    expect(validate('root.ts')).toBeNull();
    expect(validate('a/b.ts')).toContain('validation.invalidChars');
    expect(validate('src')).toContain('validation.exists');
  });

  it('does not rename or drag the project root or a row git reports deleted', () => {
    const { node, view } = setup();
    const { canDrag, canRename } = view.result.current;
    expect(canRename(node(PROJECT_ROOT_NODE_ID))).toBe(false);
    expect(canRename(node('gone.ts'))).toBe(false);
    expect(canRename(node('root.ts'))).toBe(true);
    expect(canDrag(node(PROJECT_ROOT_NODE_ID))).toBe(false);
    expect(canDrag(node('gone.ts'))).toBe(false);
  });
});

describe('useFileTreeActions — rename', () => {
  it('renames through the service and refreshes', async () => {
    service.renameProjectFile.mockResolvedValue({ newPath: '/repo/main.ts', success: true });
    const { node, view } = setup();

    await act(() => view.result.current.onCommitRename(node('root.ts'), 'main.ts'));

    expect(service.renameProjectFile).toHaveBeenCalledWith({
      deviceId: undefined,
      newName: 'main.ts',
      path: '/repo/root.ts',
      workingDirectory: '/repo',
    });
    // An open tab of the renamed file follows it to the new path.
    expect(retargetLocalFiles).toHaveBeenCalledWith(
      [{ from: '/repo/root.ts', to: '/repo/main.ts' }],
      undefined,
    );
    expect(service.refreshProjectFiles).toHaveBeenCalledTimes(1);
  });

  it('rolls back and explains a failed rename', async () => {
    service.renameProjectFile.mockRejectedValue(new Error('EBUSY'));
    const { node, view } = setup();

    let result: unknown;
    await act(async () => {
      result = await view.result.current.onCommitRename(node('root.ts'), 'main.ts');
    });

    expect(result).toBe(false);
    expect(ui.error).toHaveBeenCalledWith(
      'workingPanel.files.feedback.renameFailed {"name":"root.ts","reason":"EBUSY"}',
    );
  });

  it('starts inline rename from the menu', () => {
    const { clickMenu } = setup();
    clickMenu('src/', 'rename');
    expect(handle.startRenaming).toHaveBeenCalledWith('src/');
  });
});

describe('useFileTreeActions — move to trash', () => {
  it('confirms, warns about uncommitted changes, trashes and refreshes', async () => {
    service.trashProjectFiles.mockResolvedValue({
      items: [{ path: '/repo/src/app.ts', success: true }],
      success: true,
    });
    const { clickMenu } = setup();

    clickMenu('src/app.ts', 'trash');

    expect(ui.confirmModal).toHaveBeenCalledTimes(1);
    const [config] = ui.confirmModal.mock.calls[0];
    expect(config.title).toBe(
      'workingPanel.files.delete.confirmTitle {"name":"app.ts","trash":"workingPanel.files.trashName.mac"}',
    );
    expect(config.content).toContain('workingPanel.files.delete.fileDesc');
    expect(config.content).toContain('workingPanel.files.delete.dirtyWarning');
    expect(config.okButtonProps).toEqual({ danger: true });
    expect(config.cancelText).toBe('cancel {"ns":"common"}');

    await act(() => config.onOk());

    expect(service.trashProjectFiles).toHaveBeenCalledWith({
      deviceId: undefined,
      paths: ['/repo/src/app.ts'],
      workingDirectory: '/repo',
    });
    expect(ui.success).toHaveBeenCalledWith(
      'workingPanel.files.feedback.trashed {"name":"app.ts","trash":"workingPanel.files.trashName.mac"}',
    );
    expect(closeLocalFilesAt).toHaveBeenCalledWith(['/repo/src/app.ts'], undefined);
    expect(service.refreshProjectFiles).toHaveBeenCalledTimes(1);
  });

  it('warns about changes inside a folder and describes the recursive delete', () => {
    const { clickMenu } = setup();
    clickMenu('src/', 'trash');
    const [config] = ui.confirmModal.mock.calls[0];
    expect(config.content).toContain('workingPanel.files.delete.folderDesc');
    expect(config.content).toContain('workingPanel.files.delete.dirtyWarning');
  });

  it('acts on the whole selection when the clicked row is part of it', async () => {
    service.trashProjectFiles.mockResolvedValue({
      items: [
        { path: '/repo/root.ts', success: true },
        { error: 'EPERM', path: '/repo/src', success: false },
      ],
      success: false,
    });
    handle.getSelectedIds.mockReturnValue(['root.ts', 'src/']);
    const { clickMenu } = setup();

    clickMenu('root.ts', 'trash');

    const [config] = ui.confirmModal.mock.calls[0];
    expect(config.title).toContain('delete.confirmTitleMultiple');
    expect(config.title).toContain('"count":2');

    await act(() => config.onOk());
    expect(service.trashProjectFiles).toHaveBeenCalledWith(
      expect.objectContaining({ paths: ['/repo/root.ts', '/repo/src'] }),
    );
    // Partial success: report what went to the trash, then each failure.
    expect(ui.success).toHaveBeenCalledWith(expect.stringContaining('feedback.trashed'));
    expect(ui.error).toHaveBeenCalledWith(
      'workingPanel.files.feedback.deleteFailed {"name":"src","reason":"EPERM"}',
    );
  });

  it('fails clearly on a device without a trash instead of deleting', async () => {
    service.trashProjectFiles.mockRejectedValue(
      new Error('This device does not support moving files to the trash'),
    );
    const { clickMenu } = setup({ deviceId: 'dev_1' });

    clickMenu('root.ts', 'trash');
    await act(() => ui.confirmModal.mock.calls[0][0].onOk());

    expect(ui.error).toHaveBeenCalledWith(
      'workingPanel.files.feedback.deleteFailed {"name":"root.ts","reason":"workingPanel.files.feedback.trashUnsupported {\\"trash\\":\\"workingPanel.files.trashName.linux\\"}"}',
    );
    expect(ui.success).not.toHaveBeenCalled();
  });

  it('reports an outdated or offline device', async () => {
    const { clickMenu } = setup({ deviceId: 'dev_1' });

    service.trashProjectFiles.mockRejectedValueOnce(new Error('Unknown device RPC method: x'));
    clickMenu('root.ts', 'trash');
    await act(() => ui.confirmModal.mock.calls[0][0].onOk());
    expect(ui.error).toHaveBeenLastCalledWith(
      expect.stringContaining('workingPanel.files.feedback.unsupportedOnDevice'),
    );

    service.trashProjectFiles.mockRejectedValueOnce(new Error('DEVICE_NOT_FOUND'));
    clickMenu('root.ts', 'trash');
    await act(() => ui.confirmModal.mock.calls[1][0].onOk());
    expect(ui.error).toHaveBeenLastCalledWith(
      expect.stringContaining('workingPanel.files.feedback.deviceOffline'),
    );
  });
});

describe('useFileTreeActions — keyboard', () => {
  it('Delete and ⌘⌫ ask to trash the focused row; Enter opens a file', () => {
    const { node, view } = setup();
    const ctx = { focusedNode: node('root.ts'), selectedNodes: [] };

    expect(view.result.current.handleTreeKeyDown(keyEvent('Delete'), ctx)).toBe(true);
    expect(
      view.result.current.handleTreeKeyDown(keyEvent('Backspace', { metaKey: true }), ctx),
    ).toBe(true);
    expect(ui.confirmModal).toHaveBeenCalledTimes(2);

    expect(view.result.current.handleTreeKeyDown(keyEvent('Enter'), ctx)).toBe(true);
    expect(openLocalFile).toHaveBeenCalledWith({
      deviceId: undefined,
      filePath: '/repo/root.ts',
      workingDirectory: '/repo',
    });
  });

  it('deletes the whole selection when the focused row is in it', () => {
    const { node, view } = setup();
    view.result.current.handleTreeKeyDown(keyEvent('Delete'), {
      focusedNode: node('root.ts'),
      selectedNodes: [node('root.ts'), node('src/app.ts')],
    });
    expect(ui.confirmModal.mock.calls[0][0].title).toContain('"count":2');
  });

  it('never deletes a row git reports deleted', () => {
    const { node, view } = setup();
    expect(
      view.result.current.handleTreeKeyDown(keyEvent('Delete'), {
        focusedNode: node('gone.ts'),
        selectedNodes: [],
      }),
    ).toBe(false);
    expect(ui.confirmModal).not.toHaveBeenCalled();
  });

  it('Enter toggles a folder and unrelated keys are left alone', () => {
    const { node, view } = setup();
    const ctx = { focusedNode: node('src/'), selectedNodes: [] };

    expect(view.result.current.handleTreeKeyDown(keyEvent('Enter'), ctx)).toBe(true);
    expect(handle.setExpanded).toHaveBeenCalledWith([PROJECT_ROOT_NODE_ID, 'src/']);
    expect(view.result.current.handleTreeKeyDown(keyEvent('a'), ctx)).toBe(false);
  });

  it('⌘C then ⌘V pastes a Finder-style copy into the focused folder', async () => {
    service.copyProjectFiles.mockResolvedValue([
      { sourcePath: '/repo/src/app.ts', success: true, targetPath: '/repo/src/app copy.ts' },
    ]);
    const { node, view } = setup();

    act(() => {
      view.result.current.handleTreeKeyDown(keyEvent('c', { metaKey: true }), {
        focusedNode: node('src/app.ts'),
        selectedNodes: [],
      });
    });
    await act(async () => {
      view.result.current.handleTreeKeyDown(keyEvent('v', { metaKey: true }), {
        focusedNode: node('src/'),
        selectedNodes: [],
      });
    });

    await waitFor(() =>
      expect(service.copyProjectFiles).toHaveBeenCalledWith({
        deviceId: undefined,
        items: [{ sourcePath: '/repo/src/app.ts', targetPath: '/repo/src/app copy.ts' }],
        workingDirectory: '/repo',
      }),
    );
    expect(service.refreshProjectFiles).toHaveBeenCalled();
  });

  it('⌘V does nothing with an empty clipboard', () => {
    const { node, view } = setup();
    expect(
      view.result.current.handleTreeKeyDown(keyEvent('v', { metaKey: true }), {
        focusedNode: node('src/'),
        selectedNodes: [],
      }),
    ).toBe(false);
  });
});

describe('useFileTreeActions — cut / paste, duplicate and move', () => {
  it('cut + paste moves the entry and empties the clipboard', async () => {
    service.moveProjectFiles.mockResolvedValue([
      { newPath: '/repo/src/root.ts', sourcePath: '/repo/root.ts', success: true },
    ]);
    const { clickMenu, menu } = setup();

    expect(menu('src/').find((item) => item.key === 'paste')?.disabled).toBe(true);
    clickMenu('root.ts', 'cut');
    expect(menu('src/').find((item) => item.key === 'paste')?.disabled).toBe(false);

    clickMenu('src/', 'paste');

    await waitFor(() =>
      expect(service.moveProjectFiles).toHaveBeenCalledWith({
        deviceId: undefined,
        items: [{ newPath: '/repo/src/root.ts', oldPath: '/repo/root.ts' }],
        workingDirectory: '/repo',
      }),
    );
    await waitFor(() => expect(useFileClipboardStore.getState().clipboard).toBeUndefined());
    expect(retargetLocalFiles).toHaveBeenCalledWith(
      [{ from: '/repo/root.ts', to: '/repo/src/root.ts' }],
      undefined,
    );
  });

  it('keeps the clipboard scoped to its device and project', () => {
    const local = setup();
    local.clickMenu('root.ts', 'copy');
    const remote = setup({ deviceId: 'dev_1' });
    expect(remote.menu('src/').find((item) => item.key === 'paste')?.disabled).toBe(true);
  });

  it('refuses to paste a folder into itself', async () => {
    const { clickMenu } = setup();
    clickMenu('src/', 'copy');
    clickMenu('src/', 'paste');

    await waitFor(() =>
      expect(ui.error).toHaveBeenCalledWith(expect.stringContaining('feedback.pasteIntoItself')),
    );
    expect(service.copyProjectFiles).not.toHaveBeenCalled();
  });

  it('duplicates next to the source and opens the copy for renaming', async () => {
    service.copyProjectFiles.mockResolvedValue([
      { sourcePath: '/repo/root.ts', success: true, targetPath: '/repo/root copy.ts' },
    ]);
    const { clickMenu, params, view } = setup();

    clickMenu('root.ts', 'duplicate');

    await waitFor(() =>
      expect(service.copyProjectFiles).toHaveBeenCalledWith({
        deviceId: undefined,
        items: [{ sourcePath: '/repo/root.ts' }],
        workingDirectory: '/repo',
      }),
    );
    await waitFor(() => expect(service.refreshProjectFiles).toHaveBeenCalled());
    view.rerender({ ...params, nodes: toNodes([...baseEntries, entry('root copy.ts')]) });
    expect(handle.startRenaming).toHaveBeenCalledWith('root copy.ts');
  });

  it('moves dropped rows into the target folder and refuses clashes or self-nesting', async () => {
    service.moveProjectFiles.mockResolvedValue([
      { newPath: '/repo/src/root.ts', sourcePath: '/repo/root.ts', success: true },
    ]);
    const { node, view } = setup();
    const canDrop = (sources: string[], target: string) =>
      view.result.current.canDrop({
        sourceIds: sources,
        sourceNodes: sources.map(node),
        targetId: target,
        targetNode: node(target),
      });

    expect(canDrop(['root.ts'], 'src/')).toBe(true);
    expect(canDrop(['src/'], 'src/')).toBe(false);
    expect(canDrop([PROJECT_ROOT_NODE_ID], 'src/')).toBe(false);

    await act(() =>
      view.result.current.onMove({
        newParentId: 'src/',
        oldParentId: PROJECT_ROOT_NODE_ID,
        sourceIds: ['root.ts'],
        sourceNodes: [node('root.ts')],
        targetId: 'src/',
        targetNode: node('src/'),
      }),
    );
    expect(service.moveProjectFiles).toHaveBeenCalledWith({
      deviceId: undefined,
      items: [{ newPath: '/repo/src/root.ts', oldPath: '/repo/root.ts' }],
      workingDirectory: '/repo',
    });
  });

  it('refuses a drop onto a same-named entry', () => {
    const { node, view } = setup({
      knownEntries: [...baseEntries, entry('src/root.ts')],
    });
    expect(
      view.result.current.canDrop({
        sourceIds: ['root.ts'],
        sourceNodes: [node('root.ts')],
        targetId: 'src/',
        targetNode: node('src/'),
      }),
    ).toBe(false);
  });

  it('keeps the chat-input drag payload while allowing in-tree moves', () => {
    const { node, view } = setup();
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'all',
      setData: (type: string, value: string) => data.set(type, value),
      setDragImage: vi.fn(),
    };
    const row = document.createElement('div');
    document.body.append(row);

    view.result.current.handleNodeDragStart(node('root.ts'), {
      currentTarget: row,
      dataTransfer,
    } as never);

    expect(JSON.parse(data.get(WORKSPACE_FILE_DRAG_MIME)!)).toEqual({
      isDirectory: false,
      name: 'root.ts',
      path: '/repo/root.ts',
    });
    expect(dataTransfer.effectAllowed).toBe('copyMove');
  });
});

describe('useFileTreeActions — refresh, terminal and remote', () => {
  it('refresh re-reads the index, git status and lazy listings', async () => {
    const { params, view } = setup();
    await act(() => view.result.current.refresh());
    expect(service.refreshProjectFiles).toHaveBeenCalledWith(undefined, '/repo');
    expect(params.invalidateCollapsedChildren).toHaveBeenCalled();
    expect(view.result.current.refreshing).toBe(false);
  });

  it('opens a terminal tab in the folder and shows the panel', async () => {
    const toggleTerminalPanel = vi.fn();
    useGlobalStore.setState({ toggleTerminalPanel });
    const { clickMenu } = setup();

    clickMenu('src/app.ts', 'open-in-terminal');

    await waitFor(() => expect(terminal.createTab).toHaveBeenCalledWith('tpc_1', '/repo/src'));
    await waitFor(() => expect(toggleTerminalPanel).toHaveBeenCalledWith(true));
  });

  it('reports a terminal that failed to start', async () => {
    const toggleTerminalPanel = vi.fn();
    useGlobalStore.setState({ toggleTerminalPanel });
    terminal.createTab.mockImplementation(async () => {
      terminal.createErrors = { tpc_1: 'no pty' };
    });
    const { clickMenu } = setup();

    clickMenu(PROJECT_ROOT_NODE_ID, 'open-in-terminal');

    await waitFor(() =>
      expect(ui.error).toHaveBeenCalledWith('workingPanel.files.feedback.terminalFailed'),
    );
    expect(terminal.createTab).toHaveBeenCalledWith('tpc_1', '/repo');
    expect(toggleTerminalPanel).not.toHaveBeenCalled();
  });

  it('has no terminal or reveal entries on a remote device', () => {
    const { view } = setup({ deviceId: 'dev_1' });
    const keys = view.result.current.getBlankContextMenuItems().map((item) => item?.key);
    expect(keys).not.toContain('open-in-terminal');
    expect(keys).not.toContain('show-in-system');
    expect(keys).toEqual(expect.arrayContaining(['new-file', 'new-folder', 'paste', 'refresh']));
  });

  it('uses the root menu for the project root row', () => {
    const { menu } = setup();
    expect(menu(PROJECT_ROOT_NODE_ID).map((item) => item?.key)).toContain('refresh');
  });
});

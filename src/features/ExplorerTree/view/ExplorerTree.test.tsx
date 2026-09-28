import { AGENT_DOCUMENT_CATEGORY, CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { RefObject } from 'react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import DocumentExplorerTree from '@/features/AgentDocumentsExplorer/DocumentExplorerTree';
import type { AgentDocumentItem } from '@/features/AgentDocumentsExplorer/types';
import { canGoNative } from '@/libs/contextMenu/canGoNative';
import { toNativeTemplate } from '@/libs/contextMenu/toNativeTemplate';

import type { ExplorerTreeHandle, ExplorerTreeNode } from '../types';
import ExplorerTree, { getItemPathFromEventPath } from './ExplorerTree';

const showContextMenu = vi.hoisted(() => vi.fn());

vi.mock('@/libs/contextMenu', () => ({
  showContextMenu,
}));

vi.mock('@lobehub/ui/icons', () => ({
  SkillsIcon: () => null,
}));

vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  App: {
    useApp: () => ({
      message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
      modal: { confirm: vi.fn() },
    }),
  },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    removeDocument: vi.fn(),
  },
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

const dispatchRealContextMenuEventRetargetedPastShadowRoot = (
  shadowRow: HTMLElement,
  shadowHost: Element,
): void => {
  const contextMenuEvent = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(contextMenuEvent, 'target', { configurable: true, value: shadowHost });
  shadowRow.dispatchEvent(contextMenuEvent);
};

const createFolderDocument = (overrides: Partial<AgentDocumentItem>): AgentDocumentItem =>
  ({
    accessPublic: 0,
    accessSelf: 0,
    accessShared: 0,
    agentId: 'agent-1',
    category: AGENT_DOCUMENT_CATEGORY,
    content: '',
    createdAt: new Date('2026-05-09T00:00:00Z'),
    deletedAt: null,
    deletedByAgentId: null,
    deletedByUserId: null,
    deleteReason: null,
    description: null,
    documentId: 'doc-1',
    editorData: null,
    filename: 'Notes',
    fileType: CUSTOM_FOLDER_FILE_TYPE,
    id: 'folder-row',
    isFolder: true,
    isSkillBundle: false,
    isSkillIndex: false,
    loadRules: {},
    metadata: null,
    parentId: null,
    policy: null,
    policyLoad: 'disabled',
    policyLoadFormat: 'raw',
    policyLoadPosition: 'before-first-user',
    policyLoadRule: 'always',
    source: null,
    sourceType: 'file',
    templateId: null,
    title: 'Notes',
    updatedAt: new Date('2026-05-09T00:00:00Z'),
    userId: 'user-1',
    ...overrides,
  }) as AgentDocumentItem;

describe('ExplorerTree', () => {
  it('commits folder renames through the canonical adapter path', async () => {
    let handleRef: React.RefObject<ExplorerTreeHandle | null>;
    const onCommitRename = vi.fn();

    function TestWrapper() {
      handleRef = useRef<ExplorerTreeHandle>(null);
      return (
        <ExplorerTree
          nodes={[{ id: 'folder', isFolder: true, name: 'Notes', parentId: null }]}
          ref={handleRef}
          onCommitRename={onCommitRename}
        />
      );
    }

    const { container } = render(<TestWrapper />);

    act(() => {
      handleRef.current?.startRenaming('folder');
    });

    const host = container.querySelector('file-tree-container');

    await waitFor(() => {
      expect(host?.shadowRoot?.querySelector('[data-item-rename-input]')).toBeInstanceOf(
        HTMLInputElement,
      );
    });

    const input = host?.shadowRoot?.querySelector('[data-item-rename-input]');
    expect(input).toBeInstanceOf(HTMLInputElement);

    fireEvent.input(input!, { target: { value: 'Archive' } });
    fireEvent.blur(input!);

    expect(onCommitRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'folder', isFolder: true }),
      'Archive',
    );
  });

  it('survives a selected node whose parent folder turns into a file', () => {
    // @pierre/trees asks for the directory child index of every intermediate
    // path segment before checking that the segment is a directory, so looking
    // up `Notes/readme.md` once `Notes` is a file throws "Unknown directory
    // child index for node N" instead of resolving to nothing. resetPaths
    // re-resolves the previous selection against the new store, so a refresh
    // that reshapes the tree under a selected row used to kill the whole route.
    const folderTree: ExplorerTreeNode<undefined>[] = [
      { id: 'notes', isFolder: true, name: 'Notes', parentId: null },
      { id: 'notes-child', isFolder: false, name: 'readme.md', parentId: 'notes' },
      // keeps `readme.md` interned as a segment after `Notes` stops being a folder
      { id: 'archive', isFolder: true, name: 'Archive', parentId: null },
      { id: 'archive-child', isFolder: false, name: 'readme.md', parentId: 'archive' },
    ];
    const flattenedTree: ExplorerTreeNode<undefined>[] = [
      { id: 'notes', isFolder: false, name: 'Notes', parentId: null },
      { id: 'archive', isFolder: true, name: 'Archive', parentId: null },
      { id: 'archive-child', isFolder: false, name: 'readme.md', parentId: 'archive' },
    ];

    const { container, rerender } = render(
      <ExplorerTree nodes={folderTree} selectedIds={['notes-child']} />,
    );

    // the selection prop stays put: the row it points at is what disappears
    expect(() =>
      rerender(<ExplorerTree nodes={flattenedTree} selectedIds={['notes-child']} />),
    ).not.toThrow();
    expect(container.querySelector('file-tree-container')).toBeInstanceOf(HTMLElement);
  });

  it('resolves the clicked segment inside a flattened directory row', () => {
    const parentSegment = document.createElement('span');
    parentSegment.setAttribute('data-item-flattened-subitem', 'Parent/');

    const childSegment = document.createElement('span');
    childSegment.setAttribute('data-item-flattened-subitem', 'Parent/Child/');

    const row = document.createElement('button');
    row.dataset.type = 'item';
    row.dataset.itemPath = 'Parent/Child/';

    expect(getItemPathFromEventPath([parentSegment, row])).toBe('Parent/');
    expect(getItemPathFromEventPath([childSegment, row])).toBe('Parent/Child/');
    expect(getItemPathFromEventPath([row])).toBe('Parent/Child/');
  });
});

describe('DocumentExplorerTree menu ownership', () => {
  it('goes native for the folder row context menu, reached through a real contextmenu DOM event', async () => {
    showContextMenu.mockClear();

    const data = [createFolderDocument({})];

    const { container } = render(
      <DocumentExplorerTree agentId="agent-1" data={data} mutate={vi.fn()} />,
      { wrapper: MemoryRouter },
    );

    const host = container.querySelector('file-tree-container');

    const folderRow = await waitFor(() => {
      const el = host?.shadowRoot?.querySelector<HTMLElement>(
        '[data-type="item"][data-item-path="Notes/"]',
      );
      expect(el).toBeInstanceOf(HTMLElement);
      return el!;
    });

    dispatchRealContextMenuEventRetargetedPastShadowRoot(folderRow, host!);

    await waitFor(() => {
      expect(showContextMenu).toHaveBeenCalledTimes(1);
    });

    const [items] = showContextMenu.mock.calls[0];

    expect(canGoNative(items)).toBe(true);
    expect({
      menu: 'ExplorerTree/documentNode',
      native: canGoNative(items),
    }).toMatchSnapshot();
    expect(toNativeTemplate(items).template).toMatchSnapshot();
  });
});

// ─── inline create / rename, blank-area menu and keys ────────────────────────

const inlineNodes: ExplorerTreeNode<{ path: string }>[] = [
  { id: 'root', isFolder: true, name: 'repo', parentId: null },
  { data: { path: 'src' }, id: 'src/', isFolder: true, name: 'src', parentId: 'root' },
  { data: { path: 'a.ts' }, id: 'a.ts', isFolder: false, name: 'a.ts', parentId: 'root' },
];

const getHost = (container: HTMLElement) => container.querySelector('file-tree-container')!;

const waitForRenameInput = (container: HTMLElement) =>
  waitFor(() => {
    const input = getHost(container).shadowRoot?.querySelector('[data-item-rename-input]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    return input as HTMLInputElement;
  });

const renderTree = (props: Partial<Parameters<typeof ExplorerTree>[0]> = {}) => {
  const ref: RefObject<ExplorerTreeHandle | null> = { current: null };
  const view = render(
    <ExplorerTree defaultExpandedIds={['root']} nodes={inlineNodes} ref={ref} {...props} />,
  );
  return { ...view, ref };
};

describe('ExplorerTree inline create', () => {
  it('opens an empty inline input under the parent and commits the typed name', async () => {
    const onCommitCreate = vi.fn();
    const { container, ref } = renderTree({ onCommitCreate });

    act(() => ref.current?.startCreating('src/', 'file'));
    const input = await waitForRenameInput(container);
    // The placeholder's own name never shows: the input starts empty.
    await waitFor(() => expect(input.value).toBe(''));

    fireEvent.input(input, { target: { value: 'notes/today.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(onCommitCreate).toHaveBeenCalledWith({
        kind: 'file',
        name: 'notes/today.md',
        parentNode: expect.objectContaining({ id: 'src/' }),
      }),
    );
  });

  it('drops the placeholder without committing when the name is left empty', async () => {
    const onCommitCreate = vi.fn();
    const { container, ref } = renderTree({ onCommitCreate });

    act(() => ref.current?.startCreating('root', 'folder'));
    const input = await waitForRenameInput(container);
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(getHost(container).shadowRoot?.querySelector('[data-item-rename-input]')).toBeNull(),
    );
    expect(onCommitCreate).not.toHaveBeenCalled();
  });

  it('keeps the input open with a hint while validateName rejects the name', async () => {
    const onCommitCreate = vi.fn();
    const validateName = vi.fn((check: { name: string }) =>
      check.name === 'a.ts' ? 'already exists' : null,
    );
    const { container, ref } = renderTree({ onCommitCreate, validateName });

    act(() => ref.current?.startCreating('root', 'file'));
    const input = await waitForRenameInput(container);
    fireEvent.input(input, { target: { value: 'a.ts' } });

    // Live hint while typing…
    await waitFor(() =>
      expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('already exists'),
    );
    expect(validateName).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'file', mode: 'create', name: 'a.ts' }),
    );

    // …and neither Enter nor blur commits it.
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onCommitCreate).not.toHaveBeenCalled();
    expect(getHost(container).shadowRoot?.querySelector('[data-item-rename-input]')).toBe(input);
    expect(input.value).toBe('a.ts');

    // Fixing the name clears the hint and commits.
    fireEvent.input(input, { target: { value: 'b.ts' } });
    await waitFor(() => expect(document.body.querySelector('[role="alert"]')).toBeNull());
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(onCommitCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'b.ts' })),
    );
  });
});

describe('ExplorerTree inline rename validation', () => {
  it('blocks a rename that validateName rejects and commits a valid one', async () => {
    const onCommitRename = vi.fn();
    const validateName = vi.fn((check: { name: string }) =>
      check.name.includes(':') ? 'bad name' : null,
    );
    const { container, ref } = renderTree({ onCommitRename, validateName });

    act(() => ref.current?.startRenaming('a.ts'));
    const input = await waitForRenameInput(container);

    fireEvent.input(input, { target: { value: 'a:b.ts' } });
    fireEvent.blur(input);
    expect(onCommitRename).not.toHaveBeenCalled();
    expect(validateName).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'rename', node: expect.objectContaining({ id: 'a.ts' }) }),
    );

    fireEvent.input(input, { target: { value: 'b.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommitRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'a.ts' }), 'b.ts');
  });
});

describe('ExplorerTree blank area and keys', () => {
  it('opens the blank-area menu for a right click that hits no row', () => {
    showContextMenu.mockClear();
    const getBlankContextMenuItems = vi.fn(() => [{ key: 'refresh', label: 'Refresh' }]);
    const { container } = renderTree({ getBlankContextMenuItems });

    fireEvent.contextMenu(getHost(container));

    expect(getBlankContextMenuItems).toHaveBeenCalledTimes(1);
    expect(showContextMenu).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'refresh', label: 'Refresh' }),
    ]);
  });

  it('hands row keys to onTreeKeyDown and stops the ones it handles', () => {
    const onTreeKeyDown = vi.fn((event: { key: string }, _ctx: unknown) => event.key === 'Delete');
    const outer = vi.fn();
    const { container } = render(
      <div onKeyDown={outer}>
        <ExplorerTree
          defaultExpandedIds={['root']}
          nodes={inlineNodes}
          onTreeKeyDown={onTreeKeyDown}
        />
      </div>,
    );

    fireEvent.keyDown(getHost(container), { key: 'Delete' });
    fireEvent.keyDown(getHost(container), { key: 'a' });

    expect(onTreeKeyDown).toHaveBeenCalledTimes(2);
    expect(onTreeKeyDown.mock.calls[0][1]).toEqual({
      focusedNode: expect.objectContaining({ id: 'root' }),
      selectedNodes: [],
    });
    // Delete was handled, so only the unhandled key reached the page.
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('rolls an optimistic rename back when onCommitRename resolves false', async () => {
    const onCommitRename = vi.fn(async () => false as const);
    const { container, ref } = renderTree({ onCommitRename });

    act(() => ref.current?.startRenaming('a.ts'));
    const input = await waitForRenameInput(container);
    fireEvent.input(input, { target: { value: 'b.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const rowPath = (path: string) =>
      getHost(container).shadowRoot?.querySelector(`[data-item-path="${path}"]`);
    await waitFor(() => expect(onCommitRename).toHaveBeenCalled());
    await waitFor(() => {
      expect(rowPath('repo/a.ts')).not.toBeNull();
      expect(rowPath('repo/b.ts')).toBeNull();
    });
  });
});

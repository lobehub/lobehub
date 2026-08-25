import { AGENT_DOCUMENT_CATEGORY, CUSTOM_FOLDER_FILE_TYPE } from '@lobechat/const';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import DocumentExplorerTree from '@/features/AgentDocumentsExplorer/DocumentExplorerTree';
import type { AgentDocumentItem } from '@/features/AgentDocumentsExplorer/types';
import { canGoNative } from '@/libs/contextMenu/canGoNative';
import { toNativeTemplate } from '@/libs/contextMenu/toNativeTemplate';

import type { ExplorerTreeHandle } from '../types';
import ExplorerTree, { getItemPathFromEventPath } from './ExplorerTree';

const showContextMenu = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
    <button aria-label={title} onClick={onClick}>
      {title}
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  genCdnUrl: () => '',
  Icon: () => <span />,
  showContextMenu,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/libs/contextMenu', () => ({
  showContextMenu,
}));

vi.mock('@lobehub/ui/icons', () => ({
  SkillsIcon: () => null,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: vi.fn(),
  DropdownMenu: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('antd', () => ({
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
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

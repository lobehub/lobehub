import {
  AGENT_DOCUMENT_CATEGORY,
  AGENT_DOCUMENT_SKILL_CATEGORY,
  CUSTOM_DOCUMENT_FILE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
} from '@lobechat/const';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExplorerTreeNode } from '@/features/ExplorerTree';

import DocumentExplorerTree from './DocumentExplorerTree';
import type { AgentDocumentItem } from './types';

const navigateMock = vi.hoisted(() => vi.fn());
const messageError = vi.hoisted(() => vi.fn());
const messageSuccess = vi.hoisted(() => vi.fn());
const messageWarning = vi.hoisted(() => vi.fn());
const modalConfirm = vi.hoisted(() => vi.fn());
const openDocumentMock = vi.hoisted(() => vi.fn());
const removeDocumentMock = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
    <button aria-label={title} onClick={onClick}>
      {title}
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: modalConfirm,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { error: messageError, success: messageSuccess, warning: messageWarning },
      modal: { confirm: modalConfirm },
    }),
  },
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    removeDocument: removeDocumentMock,
  },
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigateMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/features/ExplorerTree', () => {
  interface MockExplorerTreeProps {
    canDrag?: (node: ExplorerTreeNode<unknown>) => boolean;
    defaultExpandedIds?: string[];
    getContextMenuItems?: (node: ExplorerTreeNode<unknown>) => unknown[] | undefined;
    header?: ReactNode;
    nodes: ExplorerTreeNode<unknown>[];
    onNodeClick?: (node: ExplorerTreeNode<unknown>, event: ReactMouseEvent<HTMLElement>) => void;
  }

  interface MockMenuItem {
    key?: number | string;
    onClick?: () => void;
    type?: string;
  }

  const ExplorerTree = ({
    canDrag,
    defaultExpandedIds,
    getContextMenuItems,
    header,
    nodes,
    onNodeClick,
  }: MockExplorerTreeProps) => {
    const renderNodes = (parentId: string | null): ReactNode =>
      nodes
        .filter((node) => (node.parentId ?? null) === parentId)
        .map((node) => {
          const menuItems = (getContextMenuItems?.(node) ?? []) as MockMenuItem[];
          return (
            <div
              data-can-drag={String(canDrag?.(node) ?? true)}
              data-folder={String(!!node.isFolder)}
              data-menu-count={String(menuItems.length)}
              data-testid={`tree-node-${node.id}`}
              key={node.id}
            >
              <button
                data-testid={`tree-node-button-${node.id}`}
                onClick={(event) => onNodeClick?.(node, event)}
              >
                {node.name}
              </button>
              {node.isFolder && (
                <div data-testid={`tree-node-children-${node.id}`}>{renderNodes(node.id)}</div>
              )}
              {menuItems
                .filter((item) => item.type !== 'divider' && item.key !== undefined)
                .map((item) => (
                  <button
                    data-testid={`tree-menu-${node.id}-${String(item.key)}`}
                    key={item.key}
                    onClick={() => item.onClick?.()}
                  >
                    {item.key}
                  </button>
                ))}
            </div>
          );
        });

    return (
      <div
        data-default-expanded-ids={JSON.stringify(defaultExpandedIds ?? [])}
        data-testid="explorer-tree"
      >
        {header}
        {renderNodes(null)}
      </div>
    );
  };

  return {
    DOCUMENT_TREE_ICON_CSS: '',
    ExplorerTree,
    FOLDER_ICON_CSS: '',
    HIDE_POINTER_FOCUS_RING_CSS: '',
    getExplorerTreeStyleVars: () => ({}),
  };
});

const createDocument = (overrides: Partial<AgentDocumentItem>): AgentDocumentItem =>
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
    filename: 'document.md',
    fileType: CUSTOM_DOCUMENT_FILE_TYPE,
    id: 'agent-doc-1',
    isFolder: false,
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
    title: 'Document',
    updatedAt: new Date('2026-05-09T00:00:00Z'),
    userId: 'user-1',
    ...overrides,
  }) as AgentDocumentItem;

describe('DocumentExplorerTree', () => {
  beforeEach(() => {
    messageError.mockReset();
    messageSuccess.mockReset();
    messageWarning.mockReset();
    modalConfirm.mockReset();
    navigateMock.mockReset();
    openDocumentMock.mockReset();
    removeDocumentMock.mockReset();
    removeDocumentMock.mockResolvedValue({ deleted: true, id: 'skill-bundle-row' });
  });

  it('renders managed skill bundle as a folder with SKILL.md underneath', () => {
    const data = [
      createDocument({
        category: AGENT_DOCUMENT_SKILL_CATEGORY,
        documentId: 'skill-bundle-doc',
        fileType: 'skills/bundle',
        filename: 'youtube-comment-retrieval-workflow',
        id: 'skill-bundle-row',
        isFolder: true,
        isSkillBundle: true,
        templateId: 'agent-skill',
        title: 'YouTube Comment Retrieval Workflow',
      }),
      createDocument({
        category: AGENT_DOCUMENT_SKILL_CATEGORY,
        documentId: 'skill-index-doc',
        fileType: 'skills/index',
        filename: 'SKILL.md',
        id: 'skill-index-row',
        isSkillIndex: true,
        parentId: 'skill-bundle-doc',
        templateId: 'agent-skill',
        title: 'Generated workflow title',
      }),
      createDocument({
        documentId: 'folder-doc',
        fileType: CUSTOM_FOLDER_FILE_TYPE,
        filename: 'Notes',
        id: 'folder-row',
        isFolder: true,
        title: 'Notes',
      }),
    ];

    render(<DocumentExplorerTree agentId="agent-1" data={data} mutate={vi.fn()} />, {
      wrapper: MemoryRouter,
    });

    const bundleNode = screen.getByTestId('tree-node-skill-bundle-row');
    expect(bundleNode).toHaveAttribute('data-folder', 'true');
    expect(bundleNode).toHaveAttribute('data-can-drag', 'false');
    expect(bundleNode).toHaveAttribute('data-menu-count', '0');
    expect(within(bundleNode).getByText('SKILL.md')).toBeInTheDocument();

    const skillIndexNode = screen.getByTestId('tree-node-skill-index-row');
    expect(skillIndexNode).toHaveAttribute('data-folder', 'false');
    expect(skillIndexNode).toHaveAttribute('data-can-drag', 'false');
    expect(skillIndexNode).toHaveAttribute('data-menu-count', '0');
  });

  it('opens SKILL.md in the document page but does not open the empty skill bundle', () => {
    const data = [
      createDocument({
        category: AGENT_DOCUMENT_SKILL_CATEGORY,
        documentId: 'skill-bundle-doc',
        fileType: 'skills/bundle',
        filename: 'youtube-comment-retrieval-workflow',
        id: 'skill-bundle-row',
        isFolder: true,
        isSkillBundle: true,
        templateId: 'agent-skill',
        title: 'YouTube Comment Retrieval Workflow',
      }),
      createDocument({
        category: AGENT_DOCUMENT_SKILL_CATEGORY,
        documentId: 'skill-index-doc',
        fileType: 'skills/index',
        filename: 'SKILL.md',
        id: 'skill-index-row',
        isSkillIndex: true,
        parentId: 'skill-bundle-doc',
        templateId: 'agent-skill',
        title: 'SKILL.md',
      }),
    ];

    render(<DocumentExplorerTree agentId="agent-1" data={data} mutate={vi.fn()} />, {
      wrapper: MemoryRouter,
    });

    fireEvent.click(screen.getByTestId('tree-node-button-skill-bundle-row'));
    expect(navigateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('tree-node-button-skill-index-row'));
    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-1/docs/skill-index-doc');
  });

  it('delegates document opening to the caller when provided', () => {
    const data = [
      createDocument({
        documentId: 'doc-content-1',
        id: 'agent-doc-row-1',
        title: 'Brief',
      }),
    ];

    render(
      <DocumentExplorerTree
        agentId="agent-1"
        data={data}
        mutate={vi.fn()}
        onOpenDocument={openDocumentMock}
      />,
      {
        wrapper: MemoryRouter,
      },
    );

    fireEvent.click(screen.getByTestId('tree-node-button-agent-doc-row-1'));

    expect(openDocumentMock).toHaveBeenCalledWith('doc-content-1', 'agent-doc-row-1');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('does not default-expand document folders', () => {
    const data = [
      createDocument({
        documentId: 'folder-doc',
        fileType: CUSTOM_FOLDER_FILE_TYPE,
        filename: 'Notes',
        id: 'folder-row',
        isFolder: true,
        title: 'Notes',
      }),
      createDocument({
        documentId: 'nested-folder-doc',
        fileType: CUSTOM_FOLDER_FILE_TYPE,
        filename: 'Archive',
        id: 'nested-folder-row',
        isFolder: true,
        parentId: 'folder-doc',
        title: 'Archive',
      }),
    ];

    render(<DocumentExplorerTree agentId="agent-1" data={data} mutate={vi.fn()} />, {
      wrapper: MemoryRouter,
    });

    expect(screen.getByTestId('explorer-tree')).toHaveAttribute('data-default-expanded-ids', '[]');
  });

  it('shows delete recovery action for a managed skill bundle without SKILL.md', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    const data = [
      createDocument({
        category: AGENT_DOCUMENT_SKILL_CATEGORY,
        documentId: 'skill-bundle-doc',
        fileType: 'skills/bundle',
        filename: 'youtube-comment-retrieval-workflow',
        id: 'skill-bundle-row',
        isFolder: true,
        isSkillBundle: true,
        templateId: 'agent-skill',
        title: 'YouTube Comment Retrieval Workflow',
      }),
    ];

    render(<DocumentExplorerTree agentId="agent-1" data={data} mutate={mutate} />, {
      wrapper: MemoryRouter,
    });

    const bundleNode = screen.getByTestId('tree-node-skill-bundle-row');
    expect(bundleNode).toHaveAttribute('data-folder', 'true');
    expect(bundleNode).toHaveAttribute('data-can-drag', 'false');
    expect(bundleNode).toHaveAttribute('data-menu-count', '1');
    expect(screen.queryByTestId('tree-menu-skill-bundle-row-rename')).not.toBeInTheDocument();
    expect(screen.getByTestId('tree-menu-skill-bundle-row-delete')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tree-menu-skill-bundle-row-delete'));

    const [firstConfirmCall] = modalConfirm.mock.calls;
    const [{ onOk }] = firstConfirmCall;
    // onOk now returns synchronously so the modal closes immediately; the
    // server call runs in the background.
    onOk();

    // Optimistic removal happens before the server call.
    expect(mutate).toHaveBeenCalled();

    await waitFor(() => {
      expect(removeDocumentMock).toHaveBeenCalledWith({
        agentId: 'agent-1',
        documentId: 'skill-bundle-doc',
        id: 'skill-bundle-row',
        topicId: undefined,
      });
    });
    expect(messageSuccess).not.toHaveBeenCalled();
  });
});

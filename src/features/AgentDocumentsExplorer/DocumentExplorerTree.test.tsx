import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExplorerTreeNode } from '@/features/ExplorerTree';

import DocumentExplorerTree from './DocumentExplorerTree';
import type { AgentDocumentItem } from './types';
import {
  AGENT_SKILL_TEMPLATE_ID,
  FOLDER_FILE_TYPE,
  SKILL_BUNDLE_FILE_TYPE,
  SKILL_INDEX_FILE_TYPE,
} from './types';

const { navigate, openDocument, useMatchMock } = vi.hoisted(() => ({
  navigate: vi.fn(),
  openDocument: vi.fn(),
  useMatchMock: vi.fn(),
}));
const messageError = vi.hoisted(() => vi.fn());
const messageSuccess = vi.hoisted(() => vi.fn());
const messageWarning = vi.hoisted(() => vi.fn());
const modalConfirm = vi.hoisted(() => vi.fn());
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useMatch: () => useMatchMock(),
  useNavigate: () => navigate,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openDocument }),
}));

vi.mock('@/features/ExplorerTree', () => {
  interface MockExplorerTreeProps {
    canDrag?: (node: ExplorerTreeNode<unknown>) => boolean;
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
      <div data-testid="explorer-tree">
        {header}
        {renderNodes(null)}
      </div>
    );
  };

  return { ExplorerTree, FOLDER_ICON_CSS: '' };
});

const createDocument = (overrides: Partial<AgentDocumentItem>): AgentDocumentItem =>
  ({
    accessPublic: 0,
    accessSelf: 0,
    accessShared: 0,
    agentId: 'agent-1',
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
    fileType: 'custom/document',
    id: 'agent-doc-1',
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
    navigate.mockReset();
    messageError.mockReset();
    messageSuccess.mockReset();
    messageWarning.mockReset();
    modalConfirm.mockReset();
    openDocument.mockReset();
    removeDocumentMock.mockReset();
    removeDocumentMock.mockResolvedValue({ deleted: true, id: 'skill-bundle-row' });
    useMatchMock.mockReset();
    useMatchMock.mockReturnValue(null);
  });

  it('renders managed skill bundle as a folder with SKILL.md underneath', () => {
    const data = [
      createDocument({
        documentId: 'skill-bundle-doc',
        fileType: SKILL_BUNDLE_FILE_TYPE,
        filename: 'youtube-comment-retrieval-workflow',
        id: 'skill-bundle-row',
        templateId: AGENT_SKILL_TEMPLATE_ID,
        title: 'YouTube Comment Retrieval Workflow',
      }),
      createDocument({
        documentId: 'skill-index-doc',
        fileType: SKILL_INDEX_FILE_TYPE,
        filename: 'SKILL.md',
        id: 'skill-index-row',
        parentId: 'skill-bundle-doc',
        templateId: AGENT_SKILL_TEMPLATE_ID,
        title: 'Generated workflow title',
      }),
      createDocument({
        documentId: 'folder-doc',
        fileType: FOLDER_FILE_TYPE,
        filename: 'Notes',
        id: 'folder-row',
        title: 'Notes',
      }),
    ];

    render(<DocumentExplorerTree agentId="agent-1" data={data} mutate={vi.fn()} />);

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

  it('opens SKILL.md but does not open the empty skill bundle', () => {
    const data = [
      createDocument({
        documentId: 'skill-bundle-doc',
        fileType: SKILL_BUNDLE_FILE_TYPE,
        filename: 'youtube-comment-retrieval-workflow',
        id: 'skill-bundle-row',
        templateId: AGENT_SKILL_TEMPLATE_ID,
        title: 'YouTube Comment Retrieval Workflow',
      }),
      createDocument({
        documentId: 'skill-index-doc',
        fileType: SKILL_INDEX_FILE_TYPE,
        filename: 'SKILL.md',
        id: 'skill-index-row',
        parentId: 'skill-bundle-doc',
        templateId: AGENT_SKILL_TEMPLATE_ID,
        title: 'SKILL.md',
      }),
    ];

    render(<DocumentExplorerTree agentId="agent-1" data={data} mutate={vi.fn()} />);

    fireEvent.click(screen.getByTestId('tree-node-button-skill-bundle-row'));
    expect(openDocument).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('tree-node-button-skill-index-row'));
    expect(openDocument).toHaveBeenCalledWith('skill-index-doc');
  });

  it('shows delete recovery action for a managed skill bundle without SKILL.md', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    const data = [
      createDocument({
        documentId: 'skill-bundle-doc',
        fileType: SKILL_BUNDLE_FILE_TYPE,
        filename: 'youtube-comment-retrieval-workflow',
        id: 'skill-bundle-row',
        templateId: AGENT_SKILL_TEMPLATE_ID,
        title: 'YouTube Comment Retrieval Workflow',
      }),
    ];

    render(<DocumentExplorerTree agentId="agent-1" data={data} mutate={mutate} />);

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

import { LayersEnum } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { agentSignalService } from '@/services/agentSignal';

import AgentSignalReceiptList from './AgentSignalReceiptList';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  navigate: vi.fn(),
  openDocument: vi.fn(),
  openMemoryDetail: vi.fn(),
  rollbackReceipt: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: mocks.toastError },
}));

// Like the global passthrough mock, but interpolates `{{vars}}` so toast copy carries the reason.
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    t: (key: string, defaultValueOrOptions?: unknown) => {
      if (typeof defaultValueOrOptions === 'string') return defaultValueOrOptions;
      const options = defaultValueOrOptions as Record<string, unknown> | undefined;
      if (typeof options?.defaultValue !== 'string') return key;

      return options.defaultValue.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(options[name] ?? ''),
      );
    },
  }),
}));

vi.mock('@/libs/swr', () => ({
  mutate: mocks.mutate,
}));

vi.mock('@/hooks/useStableNavigate', () => ({
  useStableNavigate: () => mocks.navigate,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (
    selector: (state: {
      openDocument: typeof mocks.openDocument;
      openMemoryDetail: typeof mocks.openMemoryDetail;
    }) => unknown,
  ) => selector({ openDocument: mocks.openDocument, openMemoryDetail: mocks.openMemoryDetail }),
}));

vi.mock('@/services/agentSignal', () => ({
  agentSignalService: {
    rollbackReceipt: mocks.rollbackReceipt,
  },
}));

describe('AgentSignalReceiptList', () => {
  afterEach(() => {
    mocks.mutate.mockReset();
    mocks.navigate.mockReset();
    mocks.openDocument.mockReset();
    mocks.openMemoryDetail.mockReset();
    mocks.rollbackReceipt.mockReset();
    mocks.toastError.mockReset();
  });

  it('renders visible memory and skill receipts', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Saved this for future replies',
            id: 'receipt-1',
            kind: 'memory',
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'applied',
            target: {
              summary: 'Use decision-first PR reviews in future chats',
              title: 'Decision-first PR review preference',
              type: 'memory',
            },
            title: 'Memory saved',
            topicId: 'topic-1',
            userId: 'user-1',
          },
          {
            agentId: 'agent-1',
            createdAt: 2,
            detail: 'Improved how this assistant handles similar requests',
            id: 'receipt-2',
            kind: 'skill',
            sourceId: 'source-2',
            sourceType: 'client.gateway.runtime_end',
            status: 'updated',
            target: {
              id: 'agent-document-1',
              summary: 'Review metadata, diff, merge status, blockers, and risks',
              title: 'GitHub PR review workflow',
              type: 'skill',
            },
            title: 'Skill updated',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    expect(screen.getByText('Decision-first PR review preference')).toBeInTheDocument();
    // A memory's description is its own content summary, not the generic "Memory saved".
    expect(screen.getByText('Use decision-first PR reviews in future chats')).toBeInTheDocument();
    expect(screen.queryByText('Memory saved')).not.toBeInTheDocument();
    expect(screen.getByText('GitHub PR review workflow')).toBeInTheDocument();
    expect(screen.getByText('Skill updated')).toBeInTheDocument();
  });

  it('renders receipt cards without the recent activity label', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Saved this for future replies',
            id: 'receipt-1',
            kind: 'memory',
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'applied',
            target: {
              summary: 'Saved this for future replies',
              title: 'Future reply preference',
              type: 'memory',
            },
            title: 'Memory saved',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    expect(screen.getByText('Future reply preference')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('agentSignal.receipts.recentActivity')).not.toBeInTheDocument();
  });

  it('opens skill target documents from a receipt item', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Improved how this assistant handles similar requests',
            id: 'receipt-1',
            kind: 'skill',
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'updated',
            target: {
              id: 'document-1',
              title: 'GitHub PR review workflow',
              type: 'skill',
            },
            title: 'Skill updated',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /GitHub PR review workflow/ }));

    expect(mocks.openDocument).toHaveBeenCalledWith('document-1', undefined);
  });

  it('renders receipts without openable targets as non-clickable status cards', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Reviewed recent activity and found no follow-up action.',
            id: 'receipt-1',
            kind: 'review',
            sourceId: 'source-1',
            sourceType: 'agent.signal.review',
            status: 'completed',
            title: 'Self-review completed',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('Self-review completed'));

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
    expect(
      screen.getByText('Reviewed recent activity and found no follow-up action.'),
    ).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.openDocument).not.toHaveBeenCalled();
  });

  it('opens skill targets when clicking the receipt card content', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Improved how this assistant handles similar requests',
            id: 'receipt-1',
            kind: 'skill',
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'updated',
            target: {
              id: 'document-1',
              title: 'GitHub PR review workflow',
              type: 'skill',
            },
            title: 'Skill updated',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('GitHub PR review workflow'));

    expect(mocks.openDocument).toHaveBeenCalledWith('document-1', undefined);
  });

  it('opens skill receipt document refs while keeping the bundle target id for display metadata', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Improved how this assistant handles similar requests',
            id: 'receipt-1',
            kind: 'skill',
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'updated',
            target: {
              agentDocumentId: 'index-agent-document-1',
              documentId: 'index-document-1',
              id: 'bundle-document-1',
              title: 'GitHub PR review workflow',
              type: 'skill',
            },
            title: 'Skill updated',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /GitHub PR review workflow/ }));

    expect(mocks.openDocument).toHaveBeenCalledWith('index-document-1', 'index-agent-document-1');
  });

  it('navigates memory receipts to the memory surface', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Saved this for future replies',
            id: 'receipt-1',
            kind: 'memory',
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'applied',
            target: {
              title: 'Remember this PR review workflow',
              type: 'memory',
            },
            title: 'Memory saved',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Remember this PR review workflow/ }));

    expect(mocks.navigate).toHaveBeenCalledWith('/memory');
  });

  it('opens legacy preference memory receipts without layer metadata on the preferences route', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Saved this for future replies',
            id: 'receipt-1',
            kind: 'memory',
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'applied',
            target: {
              id: 'base-memory-1',
              title: 'AmAzing- prefers the assistant to respond in Chinese.',
              type: 'memory',
            },
            title: 'Memory saved',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /AmAzing- prefers the assistant to respond in Chinese./,
      }),
    );

    expect(mocks.navigate).toHaveBeenCalledWith('/memory/preferences');
  });

  it('opens memory receipts in the Portal when layer metadata is available', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Saved this for future replies',
            id: 'receipt-1',
            kind: 'memory',
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'applied',
            target: {
              id: 'preference-1',
              memoryId: 'memory-1',
              memoryLayer: LayersEnum.Preference,
              title: 'Decision-first PR review preference',
              type: 'memory',
            },
            title: 'Memory saved',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText('Decision-first PR review preference'));

    expect(mocks.openMemoryDetail).toHaveBeenCalledWith({
      id: 'preference-1',
      layer: LayersEnum.Preference,
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  describe('memory receipt title, description and undo', () => {
    const memoryReceipt = (overrides: Record<string, unknown> = {}) => ({
      agentId: 'agent-1',
      createdAt: 1,
      detail: 'Saved this for future replies',
      id: 'receipt-memory',
      kind: 'memory' as const,
      metadata: { rollbackStatus: 'available' as const },
      sourceId: 'source-1',
      sourceType: 'agent.execution.completed',
      status: 'applied' as const,
      target: {
        id: 'preference-1',
        memoryId: 'memory-1',
        memoryLayer: LayersEnum.Preference,
        operation: 'create' as const,
        summary: 'Lead code reviews with the decision, then the evidence',
        title: 'Decision-first PR review preference',
        type: 'memory' as const,
      },
      title: 'Memory saved',
      topicId: 'topic-1',
      userId: 'user-1',
      ...overrides,
    });

    it('renders the memory title, its summary and an undo action', () => {
      render(<AgentSignalReceiptList receipts={[memoryReceipt()]} />);

      expect(screen.getByText('Decision-first PR review preference')).toBeInTheDocument();
      expect(
        screen.getByText('Lead code reviews with the decision, then the evidence'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    });

    it('falls back to the localized kind title only when the memory has no title', () => {
      render(
        <AgentSignalReceiptList
          receipts={[
            memoryReceipt({
              metadata: {},
              target: { memoryLayer: LayersEnum.Preference, type: 'memory' },
            }),
          ]}
        />,
      );

      expect(screen.getByText('Memory saved')).toBeInTheDocument();
      expect(screen.getByText('Saved this for future replies')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    });

    it('hides undo for memory updates', () => {
      render(
        <AgentSignalReceiptList
          receipts={[
            memoryReceipt({
              target: {
                id: 'identity-1',
                memoryLayer: LayersEnum.Identity,
                operation: 'update',
                title: 'Senior engineer',
                type: 'memory',
              },
            }),
          ]}
        />,
      );

      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    });

    it('undoes the memory by receipt id and shows the cancelled state', async () => {
      mocks.rollbackReceipt.mockResolvedValueOnce({
        receiptId: 'receipt-memory',
        status: 'rolled_back',
      });

      render(<AgentSignalReceiptList receipts={[memoryReceipt()]} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      await waitFor(() => {
        expect(agentSignalService.rollbackReceipt).toHaveBeenCalledWith({
          receiptId: 'receipt-memory',
        });
      });
      expect(await screen.findByText('Undone')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
      expect(mocks.openMemoryDetail).not.toHaveBeenCalled();
      expect(mocks.mutate).toHaveBeenCalledWith([
        'userMemory:memoryDetail',
        LayersEnum.Preference,
        'preference-1',
      ]);
      expect(mocks.toastError).not.toHaveBeenCalled();
    });

    it('shows a toast with the reason when undo fails', async () => {
      mocks.rollbackReceipt.mockResolvedValueOnce({
        reason: 'database unavailable',
        receiptId: 'receipt-memory',
        status: 'failed',
      });

      render(<AgentSignalReceiptList receipts={[memoryReceipt()]} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      await waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledWith('Undo failed: database unavailable');
      });
    });

    it('shows a toast when the memory no longer exists', async () => {
      mocks.rollbackReceipt.mockResolvedValueOnce({
        reason: 'Memory no longer exists',
        receiptId: 'receipt-memory',
        status: 'not_found',
      });

      render(<AgentSignalReceiptList receipts={[memoryReceipt()]} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      await waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledWith("Can't undo: it no longer exists");
      });
    });

    it('shows a toast with the request error when undo throws', async () => {
      mocks.rollbackReceipt.mockRejectedValueOnce(new Error('Network error'));

      render(<AgentSignalReceiptList receipts={[memoryReceipt()]} />);

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      await waitFor(() => {
        expect(mocks.toastError).toHaveBeenCalledWith('Undo failed: Network error');
      });
    });
  });

  it('shows undo only when skill rollback history metadata exists', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Improved how this assistant handles similar requests',
            id: 'receipt-1',
            kind: 'skill',
            metadata: {
              agentDocumentId: 'agent-document-1',
              documentId: 'document-1',
              historyId: 'history-1',
              rollbackStatus: 'available',
            },
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'updated',
            target: {
              id: 'document-1',
              title: 'GitHub PR review workflow',
              type: 'skill',
            },
            title: 'Skill updated',
            topicId: 'topic-1',
            userId: 'user-1',
          },
          {
            agentId: 'agent-1',
            createdAt: 2,
            detail: 'Saved this for future replies',
            id: 'receipt-2',
            kind: 'memory',
            metadata: {
              documentId: 'memory-document-1',
              historyId: 'history-2',
            },
            sourceId: 'source-2',
            sourceType: 'client.gateway.runtime_end',
            status: 'applied',
            target: {
              title: 'Future reply preference',
              type: 'memory',
            },
            title: 'Memory saved',
            topicId: 'topic-1',
            userId: 'user-1',
          },
          {
            agentId: 'agent-1',
            createdAt: 3,
            detail: 'Improved how this assistant handles similar requests',
            id: 'receipt-3',
            kind: 'skill',
            metadata: {
              rollbackStatus: 'available',
            },
            sourceId: 'source-3',
            sourceType: 'client.gateway.runtime_end',
            status: 'updated',
            target: {
              id: 'document-3',
              title: 'Issue triage workflow',
              type: 'skill',
            },
            title: 'Skill updated',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    expect(screen.getAllByText('Undo')).toHaveLength(1);
  });

  it('calls rollback service and updates visible status after undo', async () => {
    mocks.rollbackReceipt.mockResolvedValueOnce({
      agentDocumentId: 'agent-document-1',
      documentId: 'document-1',
      historyId: 'history-1',
      status: 'rolled_back',
    });

    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Improved how this assistant handles similar requests',
            id: 'receipt-1',
            kind: 'skill',
            metadata: {
              agentDocumentId: 'agent-document-1',
              documentId: 'document-1',
              historyId: 'history-1',
              rollbackStatus: 'available',
            },
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'updated',
            target: {
              id: 'document-1',
              title: 'GitHub PR review workflow',
              type: 'skill',
            },
            title: 'Skill updated',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      expect(agentSignalService.rollbackReceipt).toHaveBeenCalledWith({
        agentDocumentId: 'agent-document-1',
        documentId: 'document-1',
        historyId: 'history-1',
        receiptId: 'receipt-1',
      });
    });
    expect(mocks.openDocument).not.toHaveBeenCalled();
    expect(await screen.findByText('Rolled back')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('ignores duplicate undo clicks while rollback is pending', async () => {
    let resolveRollback!: (value: {
      agentDocumentId: string;
      documentId: string;
      historyId: string;
      status: string;
    }) => void;
    mocks.rollbackReceipt.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRollback = resolve;
      }),
    );

    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Improved how this assistant handles similar requests',
            id: 'receipt-1',
            kind: 'skill',
            metadata: {
              agentDocumentId: 'agent-document-1',
              documentId: 'document-1',
              historyId: 'history-1',
              rollbackStatus: 'available',
            },
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'updated',
            target: {
              id: 'document-1',
              title: 'GitHub PR review workflow',
              type: 'skill',
            },
            title: 'Skill updated',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    const undo = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    fireEvent.click(undo);

    expect(screen.getByText('Rolling back')).toBeInTheDocument();
    await waitFor(() => {
      expect(agentSignalService.rollbackReceipt).toHaveBeenCalledTimes(1);
    });
    expect(mocks.openDocument).not.toHaveBeenCalled();

    resolveRollback({
      agentDocumentId: 'agent-document-1',
      documentId: 'document-1',
      historyId: 'history-1',
      status: 'rolled_back',
    });

    expect(await screen.findByText('Rolled back')).toBeInTheDocument();
  });

  it('uses the server receipt metadata on remount so refreshed receipts no longer show undo', () => {
    const availableReceipt = {
      agentId: 'agent-1',
      createdAt: 1,
      detail: 'Improved how this assistant handles similar requests',
      id: 'receipt-1',
      kind: 'skill' as const,
      metadata: {
        agentDocumentId: 'agent-document-1',
        documentId: 'document-1',
        historyId: 'history-1',
        rollbackStatus: 'available' as const,
      },
      sourceId: 'source-1',
      sourceType: 'client.gateway.runtime_end',
      status: 'updated' as const,
      target: {
        id: 'document-1',
        title: 'GitHub PR review workflow',
        type: 'skill' as const,
      },
      title: 'Skill updated',
      topicId: 'topic-1',
      userId: 'user-1',
    };
    const rolledBackReceipt = {
      ...availableReceipt,
      metadata: {
        ...availableReceipt.metadata,
        rollbackStatus: 'rolled_back' as const,
      },
    };

    const { rerender } = render(<AgentSignalReceiptList receipts={[availableReceipt]} />);

    expect(screen.getByText('Undo')).toBeInTheDocument();

    rerender(<AgentSignalReceiptList receipts={[rolledBackReceipt]} />);

    expect(screen.queryByText('Undo')).not.toBeInTheDocument();
    expect(screen.getByText('Rolled back')).toBeInTheDocument();
  });

  it('shows the not found rollback label from the server status', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Improved how this assistant handles similar requests',
            id: 'receipt-1',
            kind: 'skill',
            metadata: {
              documentId: 'document-1',
              historyId: 'history-1',
              rollbackStatus: 'not_found',
            },
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'updated',
            target: {
              id: 'document-1',
              title: 'GitHub PR review workflow',
              type: 'skill',
            },
            title: 'Skill updated',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    expect(screen.getByText('Not found')).toBeInTheDocument();
    expect(screen.queryByText('Undo')).not.toBeInTheDocument();
  });

  it('does not show undo for missing rollback metadata', () => {
    render(
      <AgentSignalReceiptList
        receipts={[
          {
            agentId: 'agent-1',
            createdAt: 1,
            detail: 'Improved how this assistant handles similar requests',
            id: 'receipt-1',
            kind: 'skill',
            sourceId: 'source-1',
            sourceType: 'client.gateway.runtime_end',
            status: 'updated',
            target: {
              id: 'document-1',
              title: 'GitHub PR review workflow',
              type: 'skill',
            },
            title: 'Skill updated',
            topicId: 'topic-1',
            userId: 'user-1',
          },
        ]}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });
});

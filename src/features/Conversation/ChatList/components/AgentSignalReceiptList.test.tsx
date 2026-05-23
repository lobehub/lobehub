import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AgentSignalReceiptList from './AgentSignalReceiptList';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openDocument: vi.fn(),
}));

vi.mock('@/hooks/useStableNavigate', () => ({
  useStableNavigate: () => mocks.navigate,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: { openDocument: (documentId: string) => void }) => unknown) =>
    selector({ openDocument: mocks.openDocument }),
}));

describe('AgentSignalReceiptList', () => {
  afterEach(() => {
    mocks.navigate.mockReset();
    mocks.openDocument.mockReset();
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
    expect(screen.getByText('GitHub PR review workflow')).toBeInTheDocument();
    expect(screen.getByText('Memory saved')).toBeInTheDocument();
    expect(screen.getByText('Skill updated')).toBeInTheDocument();
    expect(screen.getAllByTitle('Agent Signal')).toHaveLength(2);
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

    expect(mocks.openDocument).toHaveBeenCalledWith('document-1');
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

    expect(mocks.openDocument).toHaveBeenCalledWith('document-1');
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

    expect(mocks.openDocument).toHaveBeenCalledWith('index-document-1');
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

    fireEvent.click(screen.getByRole('button', { name: /Decision-first PR review preference/ }));

    expect(mocks.navigate).toHaveBeenCalledWith('/memory');
  });
});

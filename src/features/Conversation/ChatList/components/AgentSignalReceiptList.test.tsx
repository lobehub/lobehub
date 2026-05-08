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
  });

  it('collapses recent activity receipts from the label', () => {
    render(
      <AgentSignalReceiptList
        showRecentLabel
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

    fireEvent.click(screen.getByRole('button', { name: 'agentSignal.receipts.recentActivity' }));

    expect(screen.queryByText('Future reply preference')).not.toBeInTheDocument();
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

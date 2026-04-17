import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentDocumentsGroup from './AgentDocumentsGroup';

const useClientDataSWR = vi.fn();

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick?: (e: React.MouseEvent) => void; title?: string }) => (
    <button aria-label={title} onClick={onClick}>
      {title}
    </button>
  ),
  Flexbox: ({
    children,
    onClick,
    ...props
  }: {
    children?: ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <div onClick={onClick} {...props}>
      {children}
    </div>
  ),
  Skeleton: () => <div data-testid="skeleton" />,
  Text: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: { error: vi.fn(), success: vi.fn() },
      modal: { confirm: vi.fn() },
    }),
  },
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (...args: unknown[]) => useClientDataSWR(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'workingPanel.resources.empty': 'No agent documents yet',
          'workingPanel.resources.error': 'Failed to load resources',
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentSWRKeys: {
    documents: (agentId: string) => ['agent-documents', agentId],
  },
  agentDocumentService: {
    getDocuments: vi.fn(),
    removeDocument: vi.fn(),
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { activeAgentId: string }) => unknown) =>
    selector({ activeAgentId: 'agent-1' }),
}));

describe('AgentDocumentsGroup', () => {
  beforeEach(() => {
    useClientDataSWR.mockReset();
  });

  it('renders documents and delegates selection to parent', async () => {
    const onSelectDocument = vi.fn();

    useClientDataSWR.mockImplementation((key: unknown) => {
      if (Array.isArray(key) && key[0] === 'agent-documents') {
        return {
          data: [
            {
              description: 'A short brief',
              documentId: 'doc-content-1',
              filename: 'brief.md',
              id: 'doc-1',
              templateId: 'claw',
              title: 'Brief',
            },
          ],
          error: undefined,
          isLoading: false,
          mutate: vi.fn(),
        };
      }

      return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
    });

    render(<AgentDocumentsGroup selectedDocumentId={null} onSelectDocument={onSelectDocument} />);

    const item = await screen.findByText('brief.md');
    expect(item).toBeInTheDocument();
    expect(screen.getByText('A short brief')).toBeInTheDocument();

    fireEvent.click(item);
    expect(onSelectDocument).toHaveBeenCalledWith('doc-1');
  });

  it('renders empty state when no documents', () => {
    useClientDataSWR.mockReturnValue({
      data: [],
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup selectedDocumentId={null} onSelectDocument={vi.fn()} />);

    expect(screen.getByText('No agent documents yet')).toBeInTheDocument();
  });

  it('renders error state', () => {
    useClientDataSWR.mockReturnValue({
      data: [],
      error: new Error('oops'),
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<AgentDocumentsGroup selectedDocumentId={null} onSelectDocument={vi.fn()} />);

    expect(screen.getByText('Failed to load resources')).toBeInTheDocument();
  });
});

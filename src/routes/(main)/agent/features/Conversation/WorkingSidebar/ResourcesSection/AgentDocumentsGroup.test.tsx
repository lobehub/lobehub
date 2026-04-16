import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentDocumentsGroup from './AgentDocumentsGroup';

const useClientDataSWR = vi.fn();

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Text: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: (...args: unknown[]) => useClientDataSWR(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'workingPanel.agentDocuments': 'Agent Documents',
          'workingPanel.resources.empty': 'No agent documents yet',
          'workingPanel.resources.error': 'Failed to load resources',
          'workingPanel.resources.loading': 'Loading resources...',
          'workingPanel.resources.previewError': 'Failed to load preview',
          'workingPanel.resources.previewLoading': 'Loading preview...',
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
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { activeAgentId: string }) => unknown) =>
    selector({ activeAgentId: 'agent-1' }),
}));

vi.mock('@/features/FileTree', () => ({
  default: ({
    onSelectFile,
    resourceTree,
  }: {
    onSelectFile: (path: string) => void;
    resourceTree: Array<{ children?: Array<{ name: string; path: string }> }>;
  }) => (
    <div>
      {resourceTree.flatMap((node) =>
        (node.children || []).map((child) => (
          <button key={child.path} onClick={() => onSelectFile(child.path)}>
            {child.name}
          </button>
        )),
      )}
    </div>
  ),
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
          data: [{ filename: 'brief.md', id: 'doc-1', templateId: 'claw', title: 'Brief' }],
          error: undefined,
          isLoading: false,
        };
      }

      return { data: undefined, error: undefined, isLoading: false };
    });

    render(<AgentDocumentsGroup selectedDocumentId={null} onSelectDocument={onSelectDocument} />);

    expect(await screen.findByText('brief.md')).toBeInTheDocument();

    fireEvent.click(screen.getByText('brief.md'));
    expect(onSelectDocument).toHaveBeenCalledWith('doc-1');
  });
});

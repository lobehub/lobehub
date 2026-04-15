import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as swr from '@/libs/swr';
import { useGlobalStore } from '@/store/global';
import { initialState } from '@/store/global/initialState';

import Conversation from '../index';
import AgentWorkingSidebar from './index';

vi.mock('@/libs/swr', async (importOriginal) => {
  const actual = await importOriginal<typeof swr>();
  return { ...actual, useClientDataSWR: vi.fn() };
});

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ ...props }: { [key: string]: unknown }) => <button {...props} />,
  Accordion: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  AccordionItem: ({
    children,
    title,
    ...props
  }: {
    children?: ReactNode;
    title?: ReactNode;
    [key: string]: unknown;
  }) => (
    <div {...props}>
      {title}
      {children}
    </div>
  ),
  Button: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  Checkbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  DraggablePanel: ({ children, expand }: { children?: ReactNode; expand?: boolean }) => (
    <div data-expand={String(expand)} data-testid="right-panel">
      {children}
    </div>
  ),
  Avatar: ({ avatar }: { avatar?: ReactNode | string }) => <div>{avatar}</div>,
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Icon: () => <div />,
  Markdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Progress: () => <div data-testid="workspace-progress-bar" />,
  ShikiLobeTheme: {},
  Skeleton: { Button: () => <div /> },
  Tag: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TextArea: () => <textarea />,
  TooltipGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      (
        ({
          'workingPanel.resources': 'Resources',
          'workingPanel.resources.empty': 'No agent documents yet',
        }) as Record<string, string>
      )[key] || key,
  }),
}));

vi.mock('@/components/DragUploadZone', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  useUploadFiles: () => ({ handleUploadFiles: vi.fn() }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector?.({
      activeAgentId: 'agent-1',
      useFetchBotProviders: () => ({ data: [], isLoading: false }),
      useFetchPlatformDefinitions: () => ({ data: [], isLoading: false }),
    }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentModel: () => 'mock-model',
    currentAgentModelProvider: () => 'mock-provider',
  },
}));

vi.mock('@/features/Conversation/store', () => ({
  dataSelectors: {
    dbMessages: (state: { dbMessages?: unknown[] }) => state.dbMessages,
  },
  useConversationStore: (selector: (state: { dbMessages: unknown[] }) => unknown) =>
    selector({ dbMessages: [] }),
}));

vi.mock('../ConversationArea', () => ({
  default: () => <div>conversation-area</div>,
}));

vi.mock('../Header', () => ({
  default: () => <div>chat-header</div>,
}));

vi.mock('./AgentDocumentEditorPanel', () => ({
  default: ({ selectedDocumentId }: { selectedDocumentId: string | null }) => (
    <div data-testid="workspace-document-panel">{selectedDocumentId}</div>
  ),
}));

beforeEach(() => {
  vi.mocked(swr.useClientDataSWR).mockImplementation((() => ({
    data: [],
    error: undefined,
    isLoading: false,
  })) as unknown as typeof swr.useClientDataSWR);
  useGlobalStore.setState(initialState);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Conversation right panel mount', () => {
  it('mounts the conversation-side right panel path and respects the existing global right-panel state', async () => {
    const { unmount } = render(<Conversation />);

    expect(screen.getByText('chat-header')).toBeInTheDocument();
    expect(screen.getByText('conversation-area')).toBeInTheDocument();
    expect(screen.getByTestId('right-panel')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-resources')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('right-panel')).toHaveAttribute('data-expand', 'true');
      expect(useGlobalStore.getState().status.showRightPanel).toBe(true);
    });

    unmount();

    expect(useGlobalStore.getState().status.showRightPanel).toBe(true);
  });

  it('renders resources section and empty state', () => {
    render(<AgentWorkingSidebar selectedDocumentId={null} onSelectDocument={vi.fn()} />);

    const resources = screen.getByTestId('workspace-resources');

    expect(resources).toHaveTextContent('Resources');
    expect(resources).toHaveTextContent('No agent documents yet');
  });

  it('switches to document editor inside the right panel when a document is selected', () => {
    render(<AgentWorkingSidebar selectedDocumentId={'doc-1'} onSelectDocument={vi.fn()} />);

    expect(screen.getByTestId('right-panel')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-document-panel')).toHaveTextContent('doc-1');
    expect(screen.queryByTestId('workspace-resources')).not.toBeInTheDocument();
  });
});

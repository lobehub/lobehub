/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssistantContentBlock } from '@/types/index';

import WorkflowCollapse from './WorkflowCollapse';

let mockIsGenerating = true;

vi.mock('@lobehub/ui', () => ({
  Accordion: ({ children, expandedKeys }: { children?: ReactNode; expandedKeys?: string[] }) => (
    <div data-expanded-keys={JSON.stringify(expandedKeys ?? [])} data-testid="workflow-accordion">
      {children}
    </div>
  ),
  AccordionItem: ({ children, title }: { children?: ReactNode; title?: ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{children}</div>
    </div>
  ),
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Icon: ({ icon: IconComponent }: { icon?: ComponentType }) =>
    IconComponent ? (
      <div
        data-icon={IconComponent.displayName || IconComponent.name || 'unknown'}
        data-testid="icon"
      >
        <IconComponent />
      </div>
    ) : (
      <div />
    ),
  ShikiLobeTheme: {},
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  m: {
    div: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
    span: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <span {...props}>{children}</span>
    ),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      (
        ({
          'workflow.awaitingConfirmation': 'Awaiting your confirmation',
          'workflow.collapse': 'Collapse',
          'workflow.expandFull': 'Expand fully',
          'workflow.working': 'Working...',
        }) as Record<string, string>
      )[key] ||
      options?.defaultValue ||
      key,
  }),
}));

vi.mock('@/components/NeuralNetworkLoading', () => ({
  default: () => <div>loading</div>,
}));

vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({
    handleScroll: vi.fn(),
    ref: { current: null },
  }),
}));

vi.mock('@/styles', () => ({
  shinyTextStyles: {
    shinyText: 'shiny-text',
  },
}));

vi.mock('../../../store', () => ({
  messageStateSelectors: {
    isMessageGenerating: () => () => mockIsGenerating,
  },
  useConversationStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('./WorkflowExpandedList', () => ({
  default: () => <div>workflow-expanded-list</div>,
}));

const makeBlocks = (toolOverrides: Record<string, unknown> = {}): AssistantContentBlock[] => [
  {
    content: '',
    id: 'block-1',
    tools: [
      {
        apiName: 'search',
        arguments: '{"query":"workflow"}',
        id: 'tool-1',
        identifier: 'search',
        type: 'builtin',
        ...toolOverrides,
      } as any,
    ],
  } as AssistantContentBlock,
];

const getExpandedKeys = () =>
  screen.getByTestId('workflow-accordion').getAttribute('data-expanded-keys');

describe('WorkflowCollapse', () => {
  afterEach(() => {
    cleanup();
    mockIsGenerating = true;
    vi.useRealTimers();
  });

  it('defaults to expanded while streaming', () => {
    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={makeBlocks()} />);

    expect(getExpandedKeys()).toBe('["workflow"]');
  });

  it('respects defaultStreamingExpanded={false} while streaming', () => {
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks()}
        defaultStreamingExpanded={false}
      />,
    );

    expect(getExpandedKeys()).toBe('[]');
  });

  it('auto expands and switches the header when confirmation is pending', async () => {
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ intervention: { status: 'pending' } })}
      />,
    );

    await waitFor(() => {
      expect(getExpandedKeys()).toBe('["workflow"]');
    });

    expect(screen.getByText('Awaiting your confirmation')).toBeInTheDocument();
    expect(screen.queryByText('Working...')).not.toBeInTheDocument();
  });

  it('pauses and hides elapsed time while confirmation is pending', () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <WorkflowCollapse assistantMessageId="msg-1" blocks={makeBlocks()} />,
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText('(3s)')).toBeInTheDocument();

    rerender(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ intervention: { status: 'pending' } })}
      />,
    );

    expect(screen.queryByText('(3s)')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText('(8s)')).not.toBeInTheDocument();

    rerender(<WorkflowCollapse assistantMessageId="msg-1" blocks={makeBlocks()} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('(4s)')).toBeInTheDocument();
  });

  it('cycles expand levels via the toggle button', () => {
    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={makeBlocks()} />);

    const toggleButton = screen.getByRole('button', { name: 'Expand fully' });
    expect(getExpandedKeys()).toBe('["workflow"]');

    act(() => {
      toggleButton.click();
    });

    expect(getExpandedKeys()).toBe('["workflow"]');
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'Collapse' }).click();
    });

    expect(getExpandedKeys()).toBe('["workflow"]');
    expect(screen.getByRole('button', { name: 'Expand fully' })).toBeInTheDocument();
  });

  it('expands to semi when accordion header is clicked from collapsed', () => {
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks()}
        defaultStreamingExpanded={false}
      />,
    );

    expect(getExpandedKeys()).toBe('[]');
    expect(screen.queryByRole('button', { name: 'Expand fully' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument();
  });

  it('collapses to collapsed when accordion header is clicked from full', () => {
    const { rerender } = render(
      <WorkflowCollapse assistantMessageId="msg-1" blocks={makeBlocks()} />,
    );

    act(() => {
      screen.getByRole('button', { name: 'Expand fully' }).click();
    });

    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();

    mockIsGenerating = false;
    rerender(<WorkflowCollapse assistantMessageId="msg-1" blocks={makeBlocks()} />);

    expect(getExpandedKeys()).toBe('["workflow"]');
  });

  it('shows green check when all tools succeed after completion', () => {
    mockIsGenerating = false;
    const blocks: AssistantContentBlock[] = [
      {
        content: '',
        id: 'block-1',
        tools: [
          {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-1',
            identifier: 'search',
            type: 'builtin',
            result: { content: 'ok' },
          } as any,
          {
            apiName: 'calculate',
            arguments: '{}',
            id: 'tool-2',
            identifier: 'calculate',
            type: 'builtin',
            result: { content: '42' },
          } as any,
        ],
      } as AssistantContentBlock,
    ];

    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={blocks} />);
    const icon = screen.getByTestId('icon');
    expect(icon).toHaveAttribute('data-icon', 'Check');
  });

  it('shows yellow warning when some tools fail after completion', () => {
    mockIsGenerating = false;
    const blocks: AssistantContentBlock[] = [
      {
        content: '',
        id: 'block-1',
        tools: [
          {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-1',
            identifier: 'search',
            type: 'builtin',
            result: { content: 'ok' },
          } as any,
          {
            apiName: 'calculate',
            arguments: '{}',
            id: 'tool-2',
            identifier: 'calculate',
            type: 'builtin',
            result: { content: null, error: { message: 'bad' } },
          } as any,
        ],
      } as AssistantContentBlock,
    ];

    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={blocks} />);
    const icon = screen.getByTestId('icon');
    expect(icon).toHaveAttribute('data-icon', 'TriangleAlert');
  });

  it('shows red x when all tools fail after completion', () => {
    mockIsGenerating = false;
    const blocks: AssistantContentBlock[] = [
      {
        content: '',
        id: 'block-1',
        tools: [
          {
            apiName: 'search',
            arguments: '{}',
            id: 'tool-1',
            identifier: 'search',
            type: 'builtin',
            result: { content: null, error: { message: 'bad' } },
          } as any,
          {
            apiName: 'calculate',
            arguments: '{}',
            id: 'tool-2',
            identifier: 'calculate',
            type: 'builtin',
            result: { content: null, error: { message: 'worse' } },
          } as any,
        ],
      } as AssistantContentBlock,
    ];

    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={blocks} />);
    const icon = screen.getByTestId('icon');
    expect(icon).toHaveAttribute('data-icon', 'X');
  });
});

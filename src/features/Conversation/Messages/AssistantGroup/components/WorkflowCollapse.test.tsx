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
    IconComponent ? <IconComponent /> : <div />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  m: {
    div: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      (
        ({
          'workflow.awaitingConfirmation': 'Awaiting your confirmation',
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
});

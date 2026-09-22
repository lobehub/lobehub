/**
 * @vitest-environment happy-dom
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssistantContentBlock } from '@/types/index';

import WorkflowCollapse from './WorkflowCollapse';

let mockIsGenerating = true;
let mockDbMessages: { createdAt?: Date; id: string; updatedAt?: Date }[] = [];

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
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
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
  Accordion: ({
    items,
    onValueChange,
    value,
  }: {
    items?: { action?: ReactNode; children?: ReactNode; key: string; title?: ReactNode }[];
    onValueChange?: (keys: string[]) => void;
    value?: string[];
  }) => {
    const isExpanded = (value ?? []).includes('workflow');
    return (
      <div data-expanded-keys={JSON.stringify(value ?? [])} data-testid="workflow-accordion">
        <button
          aria-label="toggle-accordion-header"
          type="button"
          onClick={() => onValueChange?.(isExpanded ? [] : ['workflow'])}
        />
        {items?.map((item) => (
          <div key={item.key}>
            <div>{item.title}</div>
            <div>{item.action}</div>
            <div>{item.children}</div>
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('motion/react-m', () => ({
  div: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  span: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <span {...props}>{children}</span>
  ),
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
    isAssistantGroupItemGenerating: () => () => mockIsGenerating,
    isMessageGenerating: () => () => mockIsGenerating,
  },
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({ dbMessages: mockDbMessages }),
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
    mockDbMessages = [];
    vi.useRealTimers();
  });

  it('defaults to expanded while streaming', () => {
    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={makeBlocks()} />);

    expect(getExpandedKeys()).toBe('["workflow"]');
  });

  it("respects defaultWorkflowExpandLevel='collapsed' while streaming", () => {
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks()}
        defaultWorkflowExpandLevel="collapsed"
      />,
    );

    expect(getExpandedKeys()).toBe('[]');
  });

  it("respects defaultWorkflowExpandLevel='full' after completion", () => {
    mockIsGenerating = false;
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
        defaultWorkflowExpandLevel="full"
      />,
    );

    expect(getExpandedKeys()).toBe('["workflow"]');
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it("keeps defaultWorkflowExpandLevel='full' across streaming→complete transition", () => {
    const { rerender } = render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks()}
        defaultWorkflowExpandLevel="full"
      />,
    );

    expect(getExpandedKeys()).toBe('["workflow"]');

    mockIsGenerating = false;
    rerender(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
        defaultWorkflowExpandLevel="full"
      />,
    );

    expect(getExpandedKeys()).toBe('["workflow"]');
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it("respects defaultWorkflowExpandLevel='collapsed' after completion", () => {
    mockIsGenerating = false;
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
        defaultWorkflowExpandLevel="collapsed"
      />,
    );

    expect(getExpandedKeys()).toBe('[]');
  });

  it('folds back to the summary row on completion by default', () => {
    // Regression: the built-in completion default was briefly 'full', so
    // opening a topic rendered every finished turn as a wall of tool rows.
    // A finished workflow collapses to its summary line again — one click
    // reopens it, and that click lands on the full list.
    const { rerender } = render(
      <WorkflowCollapse assistantMessageId="msg-1" blocks={makeBlocks()} />,
    );

    expect(getExpandedKeys()).toBe('["workflow"]');

    mockIsGenerating = false;
    rerender(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
      />,
    );

    expect(getExpandedKeys()).toBe('[]');
  });

  it('mounts a finished workflow collapsed', () => {
    // Entering a topic renders history straight at the completion level.
    mockIsGenerating = false;
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
      />,
    );

    expect(getExpandedKeys()).toBe('[]');
  });

  it('keeps the completion level while suppressAutoCollapse is set', () => {
    // Regression: the animated full → collapsed transition used to run right
    // before the parent folded the whole workflow into ProcessFold, shrinking
    // the layout twice and making the conversation visibly jitter.
    const { rerender } = render(
      <WorkflowCollapse suppressAutoCollapse assistantMessageId="msg-1" blocks={makeBlocks()} />,
    );

    expect(getExpandedKeys()).toBe('["workflow"]');

    mockIsGenerating = false;
    rerender(
      <WorkflowCollapse
        suppressAutoCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
      />,
    );

    expect(getExpandedKeys()).toBe('["workflow"]');
  });

  it('applies the completion level when suppressAutoCollapse is released after completion', () => {
    // The turn ended but never folded (e.g. tool-only turn with no final
    // answer), so nothing else applies the completion level — the late
    // release must. The { completion: 'collapsed' } override pins completion
    // down while streaming keeps the built-in semi, so the release has an
    // observable effect.
    const { rerender } = render(
      <WorkflowCollapse
        suppressAutoCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks()}
        defaultWorkflowExpandLevel={{ completion: 'collapsed' }}
      />,
    );
    expect(getExpandedKeys()).toBe('["workflow"]');

    mockIsGenerating = false;
    rerender(
      <WorkflowCollapse
        suppressAutoCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
        defaultWorkflowExpandLevel={{ completion: 'collapsed' }}
      />,
    );
    expect(getExpandedKeys()).toBe('["workflow"]');

    rerender(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
        defaultWorkflowExpandLevel={{ completion: 'collapsed' }}
        suppressAutoCollapse={false}
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

  it("counts elapsed time from this collapse's first step, not the whole run", () => {
    // Regression: a long turn folds into several collapses. Anchoring the timer
    // to the operation start made every fold print the same run-long number —
    // the elapsed time must cover this fold's own steps only.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T10:00:00Z'));
    mockDbMessages = [
      { createdAt: new Date('2026-09-20T09:00:00Z'), id: 'block-0' },
      { createdAt: new Date('2026-09-20T09:59:50Z'), id: 'block-1' },
    ];

    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={makeBlocks()} />);

    expect(screen.getByText('(10s)')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('(12s)')).toBeInTheDocument();
  });

  it('reports a finished fold as wall-clock time, not summed model duration', () => {
    // Regression: `performance.duration` only counts model output, so a fold
    // that sat in tool calls for two minutes advertised a few seconds.
    mockIsGenerating = false;
    mockDbMessages = [
      { createdAt: new Date('2026-09-20T09:00:00Z'), id: 'block-1' },
      { createdAt: new Date('2026-09-20T09:02:00Z'), id: 'tool-result-1' },
    ];

    const blocks = makeBlocks({ result: { content: 'ok' }, result_msg_id: 'tool-result-1' });
    blocks[0]!.performance = { duration: 4000 } as any;

    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={blocks} />);

    expect(screen.getByText('2m')).toBeInTheDocument();
    expect(screen.queryByText('4s')).not.toBeInTheDocument();
  });

  it('counts a client-executed tool from its result write, not from its start', () => {
    // Regression: the client runtime creates the tool row BEFORE invoking the
    // tool and writes the result into it afterwards, so `createdAt` is when the
    // tool STARTED. Ending the fold there left the tool's whole runtime out.
    mockIsGenerating = false;
    mockDbMessages = [
      { createdAt: new Date('2026-09-20T09:00:00Z'), id: 'block-1' },
      {
        createdAt: new Date('2026-09-20T09:00:05Z'),
        id: 'tool-result-1',
        updatedAt: new Date('2026-09-20T09:03:05Z'),
      },
    ];

    const blocks = makeBlocks({ result: { content: 'ok' }, result_msg_id: 'tool-result-1' });

    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={blocks} />);

    expect(screen.getByText('3m 5s')).toBeInTheDocument();
    expect(screen.queryByText('5s')).not.toBeInTheDocument();
  });

  it('ignores a later edit of the assistant step itself', () => {
    // An assistant row's `updatedAt` also moves when the message is edited long
    // after the turn; only tool results may extend the fold.
    mockIsGenerating = false;
    mockDbMessages = [
      {
        createdAt: new Date('2026-09-20T09:00:00Z'),
        id: 'block-1',
        updatedAt: new Date('2026-09-21T09:00:00Z'),
      },
      { createdAt: new Date('2026-09-20T09:02:00Z'), id: 'tool-result-1' },
    ];

    const blocks = makeBlocks({ result: { content: 'ok' }, result_msg_id: 'tool-result-1' });

    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={blocks} />);

    expect(screen.getByText('2m')).toBeInTheDocument();
  });

  it('falls back to model duration when the raw messages are unavailable', () => {
    // Share pages / portals render blocks without `dbMessages`; a rough number
    // still beats no number at all.
    mockIsGenerating = false;
    mockDbMessages = [];

    const blocks = makeBlocks({ result: { content: 'ok' } });
    blocks[0]!.performance = { duration: 4000 } as any;

    render(<WorkflowCollapse assistantMessageId="msg-1" blocks={blocks} />);

    expect(screen.getByText('4s')).toBeInTheDocument();
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
        defaultWorkflowExpandLevel="collapsed"
      />,
    );

    expect(getExpandedKeys()).toBe('[]');
    expect(screen.queryByRole('button', { name: 'Expand fully' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'toggle-accordion-header' }).click();
    });

    expect(getExpandedKeys()).toBe('["workflow"]');
    expect(screen.getByRole('button', { name: 'Expand fully' })).toBeInTheDocument();
  });

  it('opens a finished workflow at full on the production prop shape', () => {
    // Regression: the production caller always passes `{ streaming: <setting> }`
    // and never a completion phase, so the common 'semi' streaming preference
    // used to decide the manual open level too — opening a finished turn landed
    // on the height-capped list and needed a second ⤢ click to read it.
    mockIsGenerating = false;
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
        defaultWorkflowExpandLevel={{ streaming: 'semi' }}
      />,
    );

    expect(getExpandedKeys()).toBe('[]');

    act(() => {
      screen.getByRole('button', { name: 'toggle-accordion-header' }).click();
    });

    expect(getExpandedKeys()).toBe('["workflow"]');
    // 'Collapse' is the full level's toggle label; 'Expand fully' would mean semi.
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it('opens a finished workflow at full with no expand prop at all', () => {
    mockIsGenerating = false;
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
      />,
    );

    expect(getExpandedKeys()).toBe('[]');

    act(() => {
      screen.getByRole('button', { name: 'toggle-accordion-header' }).click();
    });

    expect(getExpandedKeys()).toBe('["workflow"]');
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it('opens at semi when a consumer pins completion to semi', () => {
    // An explicit semi completion override keeps the height cap, so the
    // consumer's compact completion experience survives a manual open.
    mockIsGenerating = false;
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks({ result: { content: 'ok' } })}
        defaultWorkflowExpandLevel={{ completion: 'semi' }}
      />,
    );

    expect(getExpandedKeys()).toBe('["workflow"]');
    expect(screen.getByRole('button', { name: 'Expand fully' })).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'toggle-accordion-header' }).click();
    });
    expect(getExpandedKeys()).toBe('[]');

    act(() => {
      screen.getByRole('button', { name: 'toggle-accordion-header' }).click();
    });

    expect(screen.getByRole('button', { name: 'Expand fully' })).toBeInTheDocument();
  });

  it('keeps the streaming list at semi when opened mid-run', () => {
    // While steps are still arriving the constrained list is what auto-scrolls
    // with them; only heterogeneous agents (streaming: 'full') opt out.
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks()}
        defaultWorkflowExpandLevel={{ streaming: 'collapsed' }}
      />,
    );

    expect(getExpandedKeys()).toBe('[]');

    act(() => {
      screen.getByRole('button', { name: 'toggle-accordion-header' }).click();
    });

    expect(screen.getByRole('button', { name: 'Expand fully' })).toBeInTheDocument();
  });

  it('manual expand jumps to full while streaming when that phase defaults to full', () => {
    // Heterogeneous agents want all 40+ tool calls visible mid-run.
    render(
      <WorkflowCollapse
        assistantMessageId="msg-1"
        blocks={makeBlocks()}
        defaultWorkflowExpandLevel={{ streaming: 'full' }}
      />,
    );

    expect(getExpandedKeys()).toBe('["workflow"]');

    act(() => {
      screen.getByRole('button', { name: 'toggle-accordion-header' }).click();
    });

    expect(getExpandedKeys()).toBe('[]');
    // Collapsed shows no toggle; re-expanding must land at full (not semi cap).
    act(() => {
      screen.getByRole('button', { name: 'toggle-accordion-header' }).click();
    });

    expect(getExpandedKeys()).toBe('["workflow"]');
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
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

  it('shows only a check when some tools fail after completion', () => {
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
    const icons = screen.getAllByTestId('icon');
    const iconNames = icons.map((node) => node.getAttribute('data-icon'));
    expect(iconNames).toContain('Check');
    expect(iconNames).not.toContain('TriangleAlert');
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

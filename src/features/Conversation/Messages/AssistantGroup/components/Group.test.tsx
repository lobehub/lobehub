/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssistantContentBlock } from '@/types/index';

import Group from './Group';

let mockIsCollapsed = false;
let mockIsGenerating = false;

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    container: 'group-container',
  }),
}));

vi.mock('../../../store', () => ({
  messageStateSelectors: {
    isAssistantGroupItemGenerating: () => () => mockIsGenerating,
    isMessageCollapsed: () => () => mockIsCollapsed,
    isMessageGenerating: () => () => mockIsGenerating,
  },
  useConversationStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('./CollapsedMessage', () => ({
  CollapsedMessage: ({ content }: { content?: string }) => <div>{content}</div>,
}));

vi.mock('./WorkflowCollapse', () => ({
  default: ({
    blocks,
    workflowChromeComplete,
  }: {
    blocks: Array<{
      content: string;
      contentOverride?: string;
      disableMarkdownStreaming?: boolean;
      domId?: string;
      error?: unknown;
      hasToolsOverride?: boolean;
      tools?: unknown[];
    }>;
    workflowChromeComplete?: boolean;
  }) => (
    <div
      data-chrome-complete={String(!!workflowChromeComplete)}
      data-testid="workflow-segment"
      data-blocks={JSON.stringify(
        blocks.map(
          ({
            content,
            contentOverride,
            disableMarkdownStreaming,
            domId,
            error,
            hasToolsOverride,
            tools,
          }) => ({
            content,
            contentOverride,
            disableMarkdownStreaming: !!disableMarkdownStreaming,
            domId,
            hasError: !!error,
            hasToolsOverride,
            toolCount: tools?.length ?? 0,
          }),
        ),
      )}
    />
  ),
}));

vi.mock('./GroupItem', () => ({
  default: ({
    content,
    contentOverride,
    disableMarkdownStreaming,
    domId,
    error,
    hasToolsOverride,
    id,
    isFirstBlock,
    tools,
  }: {
    content: string;
    contentOverride?: string;
    disableMarkdownStreaming?: boolean;
    domId?: string;
    error?: unknown;
    hasToolsOverride?: boolean;
    id: string;
    isFirstBlock?: boolean;
    tools?: unknown[];
  }) => (
    <div
      data-testid="answer-segment"
      data-block={JSON.stringify({
        content,
        contentOverride,
        disableMarkdownStreaming: !!disableMarkdownStreaming,
        domId,
        hasError: !!error,
        hasToolsOverride,
        id,
        isFirstBlock: !!isFirstBlock,
        toolCount: tools?.length ?? 0,
      })}
    />
  ),
}));

vi.mock('@/features/Conversation/Messages/components/ContentLoading', () => ({
  default: ({ id }: { id: string }) => <div data-id={id} data-testid="tail-running" />,
}));

const blk = (p: Partial<AssistantContentBlock> & { id: string }): AssistantContentBlock =>
  ({ content: '', ...p }) as AssistantContentBlock;

const parseAnswerSegment = () =>
  JSON.parse(screen.getByTestId('answer-segment').getAttribute('data-block') || '{}');

const parseAnswerSegments = () =>
  screen
    .queryAllByTestId('answer-segment')
    .map((node) => JSON.parse(node.getAttribute('data-block') || '{}'));

const parseWorkflowSegment = () =>
  JSON.parse(screen.getByTestId('workflow-segment').getAttribute('data-blocks') || '[]');

describe('Group', () => {
  afterEach(() => {
    cleanup();
    mockIsCollapsed = false;
    mockIsGenerating = false;
  });

  it('keeps a long mixed single-tool block inline in its natural order', () => {
    // No promotion/relocation: a block carrying both a tool call and long prose
    // renders as ONE inline unit (content above its tool inside ContentBlock),
    // never split into a tool-first / text-after layout.
    const longContent =
      'State management in real projects is an interesting topic!\n\nWhat specific problem are you running into right now? For example:\n- Not sure when to use useState vs Context\n- State passing between components gets messy\n- Performance issues from unnecessary re-renders';

    render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({
            content: longContent,
            id: 'block-1',
            tools: [{ apiName: 'search', id: 'tool-1' } as any],
          }),
        ]}
      />,
    );

    expect(screen.queryByTestId('workflow-segment')).not.toBeInTheDocument();
    expect(parseAnswerSegments()).toEqual([
      {
        content: longContent,
        contentOverride: undefined,
        disableMarkdownStreaming: false,
        domId: undefined,
        hasError: false,
        hasToolsOverride: undefined,
        id: 'block-1',
        isFirstBlock: false,
        toolCount: 1,
      },
    ]);
  });

  it('keeps a short mixed status block inline when there is only one tool call', () => {
    render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({
            content: '现在我来搜索资料。',
            id: 'block-1',
            tools: [{ apiName: 'search', id: 'tool-1' } as any],
          }),
        ]}
      />,
    );

    expect(screen.queryByTestId('workflow-segment')).not.toBeInTheDocument();
    expect(parseAnswerSegments()).toEqual([
      {
        content: '现在我来搜索资料。',
        disableMarkdownStreaming: false,
        domId: undefined,
        hasError: false,
        id: 'block-1',
        isFirstBlock: false,
        toolCount: 1,
      },
    ]);
  });

  it('keeps a mixed block full preamble visible above a folded multi-tool workflow', () => {
    // The whole preamble (every sentence) stays in a visible answer segment; the
    // workflow fold holds only the tools. Otherwise the prose past the first
    // sentence would be hidden inside the collapsed-by-default workflow body.
    const { container } = render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({
            content: '我先帮你查一下。接下来我会继续整理结果。',
            id: 'block-1',
            tools: [{ apiName: 'search', id: 'tool-1' } as any],
          }),
          blk({
            content: '',
            id: 'block-2',
            tools: [{ apiName: 'readFile', id: 'tool-2' } as any],
          }),
        ]}
      />,
    );

    const sequence = Array.from(container.querySelectorAll('[data-testid]')).map((node) =>
      node.getAttribute('data-testid'),
    );

    expect(sequence).toEqual(['answer-segment', 'workflow-segment']);
    expect(parseAnswerSegment()).toEqual({
      content: '我先帮你查一下。接下来我会继续整理结果。',
      contentOverride: '我先帮你查一下。接下来我会继续整理结果。',
      disableMarkdownStreaming: true,
      domId: 'block-1__answer',
      hasError: false,
      hasToolsOverride: false,
      id: 'block-1',
      isFirstBlock: false,
      toolCount: 0,
    });
    expect(parseWorkflowSegment()).toEqual([
      {
        content: '',
        contentOverride: '',
        disableMarkdownStreaming: true,
        domId: 'block-1__workflow',
        hasError: false,
        hasToolsOverride: true,
        toolCount: 1,
      },
      {
        content: '',
        disableMarkdownStreaming: false,
        domId: undefined,
        hasError: false,
        toolCount: 1,
      },
    ]);
  });

  it('keeps assistant runtime errors outside the workflow collapse', () => {
    const { container } = render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({
            content: '',
            error: {
              body: { code: 'rate_limit' },
              message: 'rate limit',
              type: 'ProviderBizError',
            } as any,
            id: 'block-1',
            tools: [
              { apiName: 'bash', id: 'tool-1' } as any,
              { apiName: 'bash', id: 'tool-2' } as any,
            ],
          }),
        ]}
      />,
    );

    const sequence = Array.from(container.querySelectorAll('[data-testid]')).map((node) =>
      node.getAttribute('data-testid'),
    );

    expect(sequence).toEqual(['workflow-segment', 'answer-segment']);
    expect(parseWorkflowSegment()).toEqual([
      {
        content: '',
        contentOverride: '',
        disableMarkdownStreaming: false,
        domId: 'block-1__workflow',
        hasError: false,
        hasToolsOverride: true,
        toolCount: 2,
      },
    ]);
    expect(parseAnswerSegment()).toEqual({
      content: '',
      contentOverride: '',
      disableMarkdownStreaming: false,
      domId: 'block-1__answer',
      hasError: true,
      hasToolsOverride: false,
      id: 'block-1',
      isFirstBlock: false,
      toolCount: 0,
    });
  });

  it('renders a single tool call inline instead of folding it', () => {
    render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({
            content: '',
            id: 'block-1',
            tools: [{ apiName: 'search', id: 'tool-1' } as any],
          }),
        ]}
      />,
    );

    expect(screen.queryByTestId('workflow-segment')).not.toBeInTheDocument();
    expect(parseAnswerSegments()).toEqual([
      {
        content: '',
        disableMarkdownStreaming: false,
        domId: undefined,
        hasError: false,
        id: 'block-1',
        isFirstBlock: false,
        toolCount: 1,
      },
    ]);
  });

  it('shows a running indicator below a settled single inline tool while still generating', () => {
    mockIsGenerating = true;
    render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({
            content: '',
            id: 'block-1',
            tools: [{ apiName: 'bash', id: 'tool-1', result: { content: 'done' } } as any],
          }),
        ]}
      />,
    );

    expect(screen.getByTestId('tail-running')).toHaveAttribute('data-id', 'assistant-1');
  });

  it('hides the running indicator while the inline tool is still executing', () => {
    mockIsGenerating = true;
    render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({
            content: '',
            id: 'block-1',
            tools: [{ apiName: 'bash', id: 'tool-1' } as any],
          }),
        ]}
      />,
    );

    expect(screen.queryByTestId('tail-running')).not.toBeInTheDocument();
  });

  it('hides the running indicator once generation has finished', () => {
    mockIsGenerating = false;
    render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({
            content: '',
            id: 'block-1',
            tools: [{ apiName: 'bash', id: 'tool-1', result: { content: 'done' } } as any],
          }),
        ]}
      />,
    );

    expect(screen.queryByTestId('tail-running')).not.toBeInTheDocument();
  });

  it('only animates the last block in a multi-block group', () => {
    const { container } = render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({ content: 'first paragraph', id: 'block-1' }),
          blk({ content: 'middle paragraph', id: 'block-2' }),
          blk({ content: 'last paragraph', id: 'block-3' }),
        ]}
      />,
    );

    const sequence = Array.from(container.querySelectorAll('[data-testid]')).map((node) =>
      node.getAttribute('data-testid'),
    );

    expect(sequence).toEqual(['answer-segment', 'answer-segment', 'answer-segment']);
    expect(
      parseAnswerSegments().map((seg: { disableMarkdownStreaming: boolean; id: string }) => ({
        disableMarkdownStreaming: seg.disableMarkdownStreaming,
        id: seg.id,
      })),
    ).toEqual([
      { disableMarkdownStreaming: true, id: 'block-1' },
      { disableMarkdownStreaming: true, id: 'block-2' },
      { disableMarkdownStreaming: false, id: 'block-3' },
    ]);
  });

  it('marks the workflow chrome complete once content renders below a settled fold while generating', () => {
    // An errored multi-tool block splits into a folded workflow (the tools) plus
    // a trailing answer segment (the error text). While still generating, the
    // collapse must not keep showing its streaming "working" header now that the
    // model has moved past it and content renders below.
    mockIsGenerating = true;

    const { container } = render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({
            content: 'Something failed while running the commands.',
            error: { message: 'boom' } as any,
            id: 'block-1',
            tools: [
              { apiName: 'command_execution', id: 'tool-1', result: { content: 'ok' } } as any,
              { apiName: 'command_execution', id: 'tool-2', result: { content: 'ok' } } as any,
            ],
          }),
        ]}
      />,
    );

    const sequence = Array.from(container.querySelectorAll('[data-testid]')).map((node) =>
      node.getAttribute('data-testid'),
    );

    expect(sequence).toEqual(['workflow-segment', 'answer-segment']);
    expect(screen.getByTestId('workflow-segment').getAttribute('data-chrome-complete')).toBe(
      'true',
    );
  });

  it('keeps the fold streaming when it still holds a pending intervention, even with content below', () => {
    // Same shape as above, but one tool awaits user confirmation. The completion
    // shortcut must be suppressed so the "awaiting confirmation" chrome survives —
    // areWorkflowToolsComplete ignores pending tools, so we cannot rely on it.
    mockIsGenerating = true;

    const { container } = render(
      <Group
        id="assistant-1"
        messageIndex={0}
        blocks={[
          blk({
            content: 'Partial output before the failure.',
            error: { message: 'boom' } as any,
            id: 'block-1',
            tools: [
              { apiName: 'command_execution', id: 'tool-1', result: { content: 'ok' } } as any,
              {
                apiName: 'command_execution',
                id: 'tool-2',
                intervention: { status: 'pending' },
              } as any,
            ],
          }),
        ]}
      />,
    );

    const sequence = Array.from(container.querySelectorAll('[data-testid]')).map((node) =>
      node.getAttribute('data-testid'),
    );

    expect(sequence).toEqual(['workflow-segment', 'answer-segment']);
    expect(screen.getByTestId('workflow-segment').getAttribute('data-chrome-complete')).toBe(
      'false',
    );
  });
});

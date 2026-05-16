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
  }) => (
    <div
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

  it('keeps long structured mixed content visible and renders the single tool inline', () => {
    const longContent =
      '后宫番 + 实际项目中的状态管理问题，这个组合挺有意思的！\n\n对于实际项目中的状态管理，你目前遇到的具体问题是什么？比如：\n- 不知道什么时候该用 useState，什么时候该用 Context\n- 组件间状态传递变得混乱\n- 性能问题（不必要的重渲染）';

    const { container } = render(
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

    const sequence = Array.from(container.querySelectorAll('[data-testid]')).map((node) =>
      node.getAttribute('data-testid'),
    );

    expect(sequence).toEqual(['answer-segment', 'answer-segment']);
    expect(parseAnswerSegments()).toEqual([
      {
        content: longContent,
        contentOverride: longContent,
        disableMarkdownStreaming: true,
        domId: 'block-1__answer',
        hasError: false,
        hasToolsOverride: false,
        id: 'block-1',
        isFirstBlock: false,
        toolCount: 0,
      },
      {
        content: '',
        contentOverride: '',
        disableMarkdownStreaming: true,
        domId: 'block-1__workflow',
        hasError: false,
        hasToolsOverride: true,
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
        disableMarkdownStreaming: true,
        domId: undefined,
        hasError: false,
        id: 'block-1',
        isFirstBlock: false,
        toolCount: 1,
      },
    ]);
  });

  it('promotes the first sentence before folding a multi-tool workflow', () => {
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
      content: '我先帮你查一下。',
      contentOverride: '我先帮你查一下。',
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
        content: '接下来我会继续整理结果。',
        contentOverride: '接下来我会继续整理结果。',
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
        disableMarkdownStreaming: true,
        domId: 'block-1__workflow',
        hasError: false,
        hasToolsOverride: true,
        toolCount: 2,
      },
    ]);
    expect(parseAnswerSegment()).toEqual({
      content: '',
      contentOverride: '',
      disableMarkdownStreaming: true,
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
        disableMarkdownStreaming: true,
        domId: undefined,
        hasError: false,
        id: 'block-1',
        isFirstBlock: false,
        toolCount: 1,
      },
    ]);
  });
});

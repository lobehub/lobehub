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
    blocks: Array<{ content: string; domId?: string; tools?: unknown[] }>;
  }) => (
    <div
      data-testid="workflow-segment"
      data-blocks={JSON.stringify(
        blocks.map(({ content, domId, tools }) => ({
          content,
          domId,
          toolCount: tools?.length ?? 0,
        })),
      )}
    />
  ),
}));

vi.mock('./GroupItem', () => ({
  default: ({
    content,
    domId,
    id,
    isFirstBlock,
    tools,
  }: {
    content: string;
    domId?: string;
    id: string;
    isFirstBlock?: boolean;
    tools?: unknown[];
  }) => (
    <div
      data-testid="answer-segment"
      data-block={JSON.stringify({
        content,
        domId,
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

const parseWorkflowSegment = () =>
  JSON.parse(screen.getByTestId('workflow-segment').getAttribute('data-blocks') || '[]');

describe('Group', () => {
  afterEach(() => {
    cleanup();
    mockIsCollapsed = false;
    mockIsGenerating = false;
  });

  it('keeps long structured mixed content visible and moves only tools into workflow', () => {
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

    expect(sequence).toEqual(['answer-segment', 'workflow-segment']);

    expect(parseAnswerSegment()).toEqual({
      content: longContent,
      domId: 'block-1__answer',
      id: 'block-1',
      isFirstBlock: false,
      toolCount: 0,
    });
    expect(parseWorkflowSegment()).toEqual([
      {
        content: '',
        domId: 'block-1__workflow',
        toolCount: 1,
      },
    ]);
  });

  it('keeps short mixed status text inside workflow', () => {
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

    expect(screen.queryByTestId('answer-segment')).not.toBeInTheDocument();
    expect(parseWorkflowSegment()).toEqual([
      {
        content: '现在我来搜索资料。',
        domId: undefined,
        toolCount: 1,
      },
    ]);
  });
});

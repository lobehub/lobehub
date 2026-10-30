/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssistantContentBlock } from '@/types/index';

import Group from './Group';

const { flags, mounts, state } = vi.hoisted(() => ({
  flags: { enableMcpApp: true },
  mounts: [] as string[],
  state: { operations: [] as { metadata: Record<string, unknown>; status: string }[] },
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableMcpApp: (s: { featureFlags: typeof flags }) => s.featureFlags.enableMcpApp,
  },
  useServerConfigStore: (selector: (s: unknown) => unknown) => selector({ featureFlags: flags }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/chat/slices/operation/selectors', () => ({
  operationSelectors: { getOperationsByMessage: () => () => state.operations },
}));

vi.mock('../../AgentCouncil/components/CouncilList', () => ({ default: () => null }));

vi.mock('../../../store', () => ({
  messageStateSelectors: {
    isAssistantGroupItemGenerating: () => () => false,
    isMessageCollapsed: () => () => false,
    isMessageCreating: () => () => false,
    isMessageGenerating: () => () => false,
  },
  useConversationStore: (selector: (s: unknown) => unknown) => selector({ dbMessages: [] }),
}));

vi.mock('./WorkflowCollapse', () => ({
  default: () => <div data-testid="workflow-segment" />,
}));

vi.mock('./ProcessFold', () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="process-fold">{children}</div>
  ),
}));

vi.mock('./GroupItem', () => {
  const MockGroupItem = ({ id }: { id: string }) => {
    useEffect(() => {
      mounts.push(id);
    }, [id]);
    return <div data-id={id} data-testid="group-item" />;
  };
  return { default: MockGroupItem };
});

const tool = (id: string, apiName: string, state?: Record<string, unknown>) =>
  ({
    apiName,
    id,
    identifier: 'weather-demo',
    result: { content: 'ok', id: `${id}-r`, state },
  }) as any;

const blocks: AssistantContentBlock[] = [
  { content: '', id: 'step-1', tools: [tool('t1', 'search_city')] },
  { content: '', id: 'step-2', tools: [tool('t2', 'get_air_quality')] },
  {
    content: '',
    id: 'step-3',
    tools: [
      tool('t3', 'get_weather', {
        content: [],
        mcpApp: { resourceUri: 'ui://weather/view' },
      }),
    ],
  },
  { content: 'Paris looks good for a day out.', id: 'step-4' },
] as AssistantContentBlock[];

afterEach(() => {
  cleanup();
  flags.enableMcpApp = true;
  mounts.length = 0;
  state.operations = [];
});

describe('Group with an MCP App view', () => {
  it('keeps the view mounted, between the fold and the answer, once the turn folds', () => {
    state.operations = [{ metadata: {}, status: 'running' }];
    const { rerender } = render(
      <Group enableProcessFold isLatestItem blocks={blocks} id="assistant-1" messageIndex={0} />,
    );
    expect(screen.queryByTestId('process-fold')).not.toBeInTheDocument();
    expect(mounts.filter((id) => id === 'step-3')).toHaveLength(1);

    // The operation ends; a changed prop lets the memoized group re-render.
    state.operations = [];
    rerender(
      <Group
        enableProcessFold
        isLatestItem
        blocks={blocks}
        disableEditing={false}
        id="assistant-1"
        messageIndex={0}
      />,
    );

    const fold = screen.getByTestId('process-fold');
    const items = screen.getAllByTestId('group-item');
    const view = items.find((node) => node.dataset.id === 'step-3')!;
    const answer = items.find((node) => node.dataset.id === 'step-4')!;

    expect(fold).toContainElement(screen.getByTestId('workflow-segment'));
    expect(fold).not.toContainElement(view);
    expect(fold.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(view.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Folding must not remount (and so reload) the view.
    expect(mounts.filter((id) => id === 'step-3')).toHaveLength(1);
  });

  it('does not remount the turn when the mcp_app flag arrives after the first paint', () => {
    flags.enableMcpApp = false;
    const plainBlocks = [
      { content: '', id: 'step-1', tools: [tool('t1', 'search_city')] },
      { content: 'Paris looks good for a day out.', id: 'step-2' },
    ] as AssistantContentBlock[];
    const { rerender } = render(<Group blocks={plainBlocks} id="assistant-1" messageIndex={0} />);
    expect(mounts).toEqual(['step-1', 'step-2']);

    // Feature flags load; a changed prop lets the memoized group re-render.
    flags.enableMcpApp = true;
    rerender(
      <Group blocks={plainBlocks} disableEditing={false} id="assistant-1" messageIndex={0} />,
    );

    expect(screen.getAllByTestId('group-item')).toHaveLength(2);
    expect(mounts).toEqual(['step-1', 'step-2']);
  });

  it('folds the view with the rest of the process while the mcp_app flag is off', () => {
    flags.enableMcpApp = false;
    render(
      <Group enableProcessFold isLatestItem blocks={blocks} id="assistant-1" messageIndex={0} />,
    );

    const fold = screen.getByTestId('process-fold');
    const items = screen.queryAllByTestId('group-item');

    expect(items.find((node) => node.dataset.id === 'step-3')).toBeUndefined();
    expect(fold).toContainElement(screen.getByTestId('workflow-segment'));
    expect(items.find((node) => node.dataset.id === 'step-4')).toBeDefined();
  });
});

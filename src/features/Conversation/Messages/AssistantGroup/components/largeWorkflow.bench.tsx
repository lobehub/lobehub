/**
 * Performance probe for a very long workflow (hundreds of tool calls in one
 * assistant group). Run it on its own, from the repo root:
 *
 *   bunx vitest bench --run --project 'app*' --maxWorkers=1 --no-file-parallelism \
 *     src/features/Conversation/Messages/AssistantGroup/components/largeWorkflow.bench.tsx
 *
 * It mounts the real expanded workflow list (`WorkflowExpandedList`, what
 * opening a workflow row renders) against a real conversation store and
 * reports: the mount time of the opened list (median of 3), the average cost of
 * one streaming chunk (a content update on the last step) while the list is
 * mounted next to the same chunk with nothing mounted (parse + reference
 * stabilisation only), and the cost of one "show earlier steps" click when the
 * list is windowed. `LOBE_PERF_TOOLS` sets the number of tool calls (600).
 * happy-dom timings are not browser timings; compare runs of this file against
 * each other, not against the browser.
 */
import type { UIChatMessage } from '@lobechat/types';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore, Provider } from '@/features/Conversation/store';
import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';

import type { RenderableAssistantContentBlock } from './types';
import WorkflowExpandedList from './WorkflowExpandedList';

vi.mock('react-i18next', () => ({
  Trans: ({ children }: PropsWithChildren) => children,
  useTranslation: () => ({ i18n: { language: 'en-US' }, t: (key: string) => key }),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));

const TOOL_COUNT = Number(process.env.LOBE_PERF_TOOLS ?? 600);
const CHUNKS = 20;
const RESULT_TEXT = 'line of tool output\n'.repeat(200);

const buildTranscript = (count: number): UIChatMessage[] => {
  const rows: any[] = [{ content: 'go', createdAt: 0, id: 'u1', role: 'user', updatedAt: 0 }];
  let parentId = 'u1';
  for (let i = 0; i < count; i++) {
    const assistantId = `a${i}`;
    const toolCallId = `call_${i}`;
    rows.push({
      content: '',
      createdAt: 10 + i * 2,
      id: assistantId,
      parentId,
      role: 'assistant',
      tools: [
        {
          apiName: 'Bash',
          arguments: JSON.stringify({ command: `ls -la /tmp/dir-${i}`, description: `step ${i}` }),
          id: toolCallId,
          identifier: 'claude-code',
          type: 'builtin',
        },
      ],
      updatedAt: 10 + i * 2,
    });
    rows.push({
      content: `${RESULT_TEXT}${i}`,
      createdAt: 11 + i * 2,
      id: `t${i}`,
      parentId: assistantId,
      role: 'tool',
      tool_call_id: toolCallId,
      updatedAt: 11 + i * 2,
    });
    parentId = `t${i}`;
  }
  rows.push({
    content: 'streaming',
    createdAt: 10 + count * 2,
    id: 'a-last',
    parentId,
    role: 'assistant',
    updatedAt: 10 + count * 2,
  });
  return rows as UIChatMessage[];
};

const newStore = () =>
  createStore({
    context: { agentId: 'agent', threadId: null, topicId: 'topic' },
    messages: buildTranscript(TOOL_COUNT),
  });

const groupBlocks = (store: ReturnType<typeof newStore>) => {
  const group = store.getState().displayMessages.find((m) => m.role === 'assistantGroup');
  if (!group?.children) throw new Error('no assistant group');
  return { blocks: group.children as RenderableAssistantContentBlock[], groupId: group.id };
};

const streamChunks = (store: ReturnType<typeof newStore>) => {
  const start = performance.now();
  for (let i = 0; i < CHUNKS; i++) {
    act(() => {
      store.getState().internal_dispatchMessage({
        id: 'a-last',
        type: 'updateMessage',
        value: { content: `streaming ${i}` },
      });
    });
  }
  return (performance.now() - start) / CHUNKS;
};

const fmt = (ms: number) => `${ms.toFixed(1)}ms`;

const mountList = (store: ReturnType<typeof newStore>, limit?: number) => {
  const { blocks, groupId } = groupBlocks(store);
  return render(
    <ServerConfigStoreProvider>
      <Provider createStore={() => store}>
        <WorkflowExpandedList
          assistantId={groupId}
          blocks={limit ? blocks.slice(0, limit) : blocks}
        />
      </Provider>
    </ServerConfigStoreProvider>,
  );
};

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe(`large workflow (${TOOL_COUNT} tools)`, () => {
  afterEach(() => cleanup());

  it('measures mount and per-chunk cost of the expanded list', { timeout: 600_000 }, () => {
    // Warm module caches (builtin renders, i18n stubs) with a small mount.
    mountList(newStore(), 5).unmount();

    const bareChunkMs = streamChunks(newStore());

    const mounts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const store = newStore();
      const start = performance.now();
      mountList(store).unmount();
      mounts.push(performance.now() - start);
    }

    const store = newStore();
    const { blocks } = groupBlocks(store);
    const mountStart = performance.now();
    const { container } = mountList(store);
    mounts.push(performance.now() - mountStart);
    const mountedNodes = container.querySelectorAll('*').length;

    const mountedChunkMs = streamChunks(store);

    const showEarlier = screen.queryByText('workflow.showEarlierSteps');
    let showEarlierMs: number | undefined;
    if (showEarlier) {
      const start = performance.now();
      act(() => {
        fireEvent.click(showEarlier);
      });
      showEarlierMs = performance.now() - start;
    }

    process.stderr.write(
      `${[
        `[perf] tools=${TOOL_COUNT} blocks=${blocks.length} dom=${mountedNodes}`,
        `[perf] mount opened list (median of ${mounts.length}): ${fmt(median(mounts))}`,
        `[perf] chunk, nothing mounted: ${fmt(bareChunkMs)}`,
        `[perf] chunk, list mounted: ${fmt(mountedChunkMs)} (list overhead ${fmt(mountedChunkMs - bareChunkMs)})`,
        showEarlierMs === undefined
          ? '[perf] show earlier: not windowed'
          : `[perf] show earlier (+100 steps): ${fmt(showEarlierMs)}`,
      ].join('\n')}\n`,
    );

    // A crashed row renders SafeBoundary's fallback instead of the tool card.
    expect(container.textContent).not.toContain('Render Error');
    expect(mountedNodes).toBeGreaterThan(0);
  });
});

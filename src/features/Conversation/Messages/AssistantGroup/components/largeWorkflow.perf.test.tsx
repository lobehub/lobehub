/**
 * Performance probe for a very long workflow (hundreds of tool calls in one
 * assistant group). Skipped by default; run it explicitly:
 *
 *   LOBE_PERF_BENCH=1 bunx vitest run --silent=false \
 *     src/features/Conversation/Messages/AssistantGroup/components/largeWorkflow.perf.test.tsx
 *
 * It mounts the real expanded workflow list against a real conversation store
 * and reports (1) the mount time of the expanded list and (2) the average cost
 * of one streaming chunk (a content update on the last step) while the list is
 * mounted, next to the same chunk with nothing mounted (parse + reference
 * stabilisation only). happy-dom timings are not browser timings; compare runs
 * of this file against each other, not against the browser.
 */
import type { UIChatMessage } from '@lobechat/types';
import { act, cleanup, render } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore, Provider } from '@/features/Conversation/store';

import ContentBlocksScroll from './ContentBlocksScroll';
import type { RenderableAssistantContentBlock } from './types';

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

describe.skipIf(!process.env.LOBE_PERF_BENCH)(`large workflow (${TOOL_COUNT} tools)`, () => {
  afterEach(() => cleanup());

  it('measures mount and per-chunk cost of the expanded list', () => {
    // Warm module caches (builtin renders, i18n stubs) with a small mount.
    {
      const warm = newStore();
      const { blocks, groupId } = groupBlocks(warm);
      const { unmount } = render(
        <Provider createStore={() => warm}>
          <ContentBlocksScroll
            assistantId={groupId}
            blocks={blocks.slice(0, 5)}
            scroll={false}
            variant="workflow"
          />
        </Provider>,
      );
      unmount();
    }

    const bare = newStore();
    const bareChunkMs = streamChunks(bare);

    const store = newStore();
    const { blocks, groupId } = groupBlocks(store);

    const mountStart = performance.now();
    const { container } = render(
      <Provider createStore={() => store}>
        <ContentBlocksScroll
          assistantId={groupId}
          blocks={blocks}
          scroll={false}
          variant="workflow"
        />
      </Provider>,
    );
    const mountMs = performance.now() - mountStart;
    const mountedNodes = container.querySelectorAll('*').length;

    const mountedChunkMs = streamChunks(store);

    process.stderr.write(
      `${[
        `[perf] tools=${TOOL_COUNT} blocks=${blocks.length} dom=${mountedNodes}`,
        `[perf] mount expanded list: ${fmt(mountMs)}`,
        `[perf] chunk, nothing mounted: ${fmt(bareChunkMs)}`,
        `[perf] chunk, list mounted: ${fmt(mountedChunkMs)} (list overhead ${fmt(mountedChunkMs - bareChunkMs)})`,
      ].join('\n')}\n`,
    );

    expect(mountMs).toBeGreaterThan(0);
  });
});

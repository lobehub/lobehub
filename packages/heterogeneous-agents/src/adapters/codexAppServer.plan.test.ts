import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { CODEX_PROPOSED_PLAN_API_NAME } from '../codexPlanMode';
import { CodexAppServerAdapter } from './codexAppServer';

/**
 * One plan-mode turn recorded from codex-cli 0.169.0 (`turn/start` with
 * `collaborationMode: plan`): an agent message, a read-only command, then the
 * plan item, with the closing agent message interleaved between the plan's
 * `item/started` and `item/completed`.
 */
const loadPlanTurn = async () =>
  (
    await readFile(
      new URL('./__fixtures__/codex/app-server-plan-turn.jsonl', import.meta.url),
      'utf8',
    )
  )
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { method: string; params: any });

describe('CodexAppServerAdapter — plan-mode plans', () => {
  it('streams the plan as a proposed_plan tool and records the completed item as its result', async () => {
    const notifications = await loadPlanTurn();
    const completedPlan = notifications.find(
      (n) => n.method === 'item/completed' && n.params.item.type === 'plan',
    )!.params.item;
    const adapter = new CodexAppServerAdapter({ sessionId: 'thread-1' });
    const events = notifications.flatMap(({ method, params }) => adapter.adapt(method, params));

    const toolsCalling = events.filter(
      (e) => e.type === 'stream_chunk' && (e.data as any).chunkType === 'tools_calling',
    );
    expect(
      toolsCalling.some((e) =>
        (e.data as any).toolsCalling.some(
          (tool: any) =>
            tool.apiName === CODEX_PROPOSED_PLAN_API_NAME &&
            tool.id === completedPlan.id &&
            tool.identifier === 'codex',
        ),
      ),
    ).toBe(true);

    // Deltas only stream a draft; the completed item is the plan of record.
    const drafts = events.filter(
      (e) =>
        e.type === 'stream_chunk' &&
        (e.data as any).chunkType === 'tool_state' &&
        (e.data as any).toolCallId === completedPlan.id,
    );
    expect(drafts.length).toBeGreaterThan(0);
    expect((drafts.at(-1)!.data as any).pluginState.plan.completed).toBe(false);

    const result = events.find(
      (e) => e.type === 'tool_result' && (e.data as any).toolCallId === completedPlan.id,
    );
    expect(result?.data).toMatchObject({
      content: completedPlan.text,
      pluginState: { plan: { completed: true, text: completedPlan.text } },
    });
    const end = events.find(
      (e) => e.type === 'tool_end' && (e.data as any).toolCallId === completedPlan.id,
    );
    expect(end?.data).toMatchObject({ isSuccess: true });

    // The plan ends before the turn does, and the turn still ends normally.
    const resultIndex = events.indexOf(result!);
    const runtimeEnd = events.findIndex((e) => e.type === 'agent_runtime_end');
    expect(resultIndex).toBeLessThan(runtimeEnd);
    expect(events[runtimeEnd].data).toEqual({});
    // The plan text is not duplicated into the reply text.
    const text = events
      .filter((e) => e.type === 'stream_chunk' && (e.data as any).chunkType === 'text')
      .map((e) => (e.data as any).content)
      .join('');
    expect(text).not.toContain(completedPlan.text.trim());
  });

  it('does not report an unfinished plan as a result when the turn is interrupted', () => {
    const adapter = new CodexAppServerAdapter({ sessionId: 'thread-1' });
    adapter.adapt('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1' } });
    adapter.adapt('item/started', {
      item: { id: 'plan-1', text: '', type: 'plan' },
      threadId: 'thread-1',
      turnId: 'turn-1',
    });
    adapter.adapt('item/plan/delta', { delta: '1. half', itemId: 'plan-1', turnId: 'turn-1' });

    const events = adapter.adapt('turn/completed', {
      threadId: 'thread-1',
      turn: { error: null, id: 'turn-1', status: 'interrupted' },
    });

    expect(events.some((e) => e.type === 'tool_result')).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        data: { isSuccess: false, toolCallId: 'plan-1' },
        type: 'tool_end',
      }),
    );
  });
});

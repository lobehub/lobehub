// @vitest-environment node
import { createSourceEvent } from '@lobechat/agent-signal/source';

import { createAgentSignalRuntime } from '../../runtime/AgentSignalRuntime';
import { createBotWakePolicy } from '../botWake/policy';
import type { WakePolicy, WakeStateSnapshot } from '../botWake/types';

const denyAll: WakePolicy = {
  evaluate: () => ({ confidence: 1, reason: 'quiet-hours', tags: ['t'], verdict: 'deny' }),
  id: 'quiet',
  mode: 'enforce',
  requires: [],
  version: 1,
};

const state = (overrides: Partial<WakeStateSnapshot>): WakeStateSnapshot => ({
  explicitMention: false,
  replyToBot: false,
  threadSubscribed: false,
  ...overrides,
});

const run = async (
  policies: WakePolicy[],
  snapshot: Partial<WakeStateSnapshot>,
  resolveState = vi.fn(async () => state(snapshot)),
) => {
  const onDecision = vi.fn();
  const runtime = await createAgentSignalRuntime({
    policies: [createBotWakePolicy({ onDecision, policies, resolveState })],
  });
  const source = createSourceEvent({
    payload: { agentId: 'agt', message: 'hi', platform: 'discord', platformThreadId: 't1' },
    sourceId: 'm1',
    sourceType: 'bot.message.merged',
  });
  const result = await runtime.emitNormalized({
    ...source,
    chain: { chainId: 'c', rootSourceId: 'm1' },
  } as never);

  return { onDecision, resolveState, result };
};

describe('bot-wake policy middleware', () => {
  it.each([
    { expected: 'deny', policies: [denyAll], snapshot: {} },
    { expected: 'abstain', policies: [], snapshot: {} },
    { expected: 'allow', policies: [denyAll], snapshot: { explicitMention: true } },
    { expected: 'allow', policies: [denyAll], snapshot: { replyToBot: true } },
  ])('reports $expected for $snapshot', async ({ expected, policies, snapshot }) => {
    const { onDecision, result } = await run(policies, snapshot);

    expect(result.status).toBe('completed');
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision.mock.calls[0][0].verdict).toBe(expected);
  });

  it('flags the explicit path as fast', async () => {
    const { onDecision } = await run([denyAll], { explicitMention: true });

    expect(onDecision.mock.calls[0][0]).toMatchObject({ fastPath: true, records: [] });
  });

  it('adds no actions or signals: the evaluation is observational', async () => {
    const { result } = await run([denyAll], {});

    expect(result).toMatchObject({ status: 'completed', trace: { actions: [], signals: [] } });
  });
});

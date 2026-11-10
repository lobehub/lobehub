import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeContext, AgentState } from '../../types';
import * as tokenCounter from '../../utils/tokenCounter';
import { GeneralChatAgent } from '../GeneralChatAgent';

vi.mock('../../utils/tokenCounter', async (importOriginal) => {
  const actual = await importOriginal<typeof tokenCounter>();
  return { ...actual, shouldCompress: vi.fn(actual.shouldCompress) };
});

const stateWith = (messages: unknown[]) =>
  ({
    messages,
    operationId: 'test-session',
    status: 'running',
    stepCount: 0,
    toolManifestMap: {},
  }) as unknown as AgentState;

const context = {
  payload: { model: 'gpt-4o-mini', provider: 'openai' },
  phase: 'init',
  session: { messageCount: 0, sessionId: 'test-session', status: 'running', stepCount: 0 },
} as unknown as AgentRuntimeContext;

const fresh = [{ content: 'Hello', id: 'user-message', role: 'user' }];
const compressed = [
  { content: 'Earlier decisions', id: 'compressed-group', role: 'compressedGroup' },
  { content: 'A follow-up', id: 'user-message', role: 'user' },
];

/** The threshold the agent measured the next request against. */
const thresholdFor = async (
  compressionConfig: ConstructorParameters<typeof GeneralChatAgent>[0]['compressionConfig'],
  messages: unknown[],
) => {
  const agent = new GeneralChatAgent({
    agentConfig: { maxSteps: 100 },
    compressionConfig: { enabled: true, ...compressionConfig },
    modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
    operationId: 'test-session',
  });
  await agent.runner(context, stateWith(messages));
  return vi.mocked(tokenCounter.shouldCompress).mock.results.at(-1)?.value.threshold;
};

describe('GeneralChatAgent — compression threshold source', () => {
  beforeEach(() => {
    vi.mocked(tokenCounter.shouldCompress).mockClear();
  });

  it('keeps a 200k-window model at a 100k threshold', async () => {
    await expect(thresholdFor({ maxWindowToken: 200_000 }, fresh)).resolves.toBe(100_000);
  });

  it('uses the model-bank ratio for the first compression', async () => {
    await expect(
      thresholdFor({ maxWindowToken: 200_000, modelThresholdRatio: 0.8 }, fresh),
    ).resolves.toBe(160_000);
  });

  it('follows a custom 400k window instead of the 128k default', async () => {
    await expect(thresholdFor({ maxWindowToken: 400_000 }, fresh)).resolves.toBe(200_000);
  });

  it('falls back to 128k × 0.5 when the window is unknown', async () => {
    await expect(thresholdFor({}, fresh)).resolves.toBe(64_000);
  });

  it('never recompresses below the model ratio', async () => {
    await expect(
      thresholdFor({ maxWindowToken: 200_000, modelThresholdRatio: 0.8 }, compressed),
    ).resolves.toBe(160_000);
  });

  it('keeps the recompression watermark above a lower model ratio', async () => {
    await expect(
      thresholdFor({ maxWindowToken: 200_000, modelThresholdRatio: 0.4 }, compressed),
    ).resolves.toBe(130_000);
  });
});

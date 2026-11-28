import {
  DEFAULT_SUB_AGENT_TIMEOUT_MS,
  MIN_SUB_AGENT_TIMEOUT_MS,
} from '@lobechat/builtin-tool-lobe-agent';
import { describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

const { lobeAgentRuntime } = await import('../lobeAgent');

/**
 * The manifest documents a 30-minute default `timeout`; without one a
 * sub-agent ran until its step cap — hours — while the user waited.
 */
describe('lobeAgentRuntime callSubAgent timeout', () => {
  const baseContext: ToolExecutionContext = {
    messageId: 'msg-1',
    serverDB: {} as any,
    toolManifestMap: {},
    topicId: 'topic-1',
    userId: 'user-1',
  };

  const call = (timeout: number | undefined) => {
    const runtime = lobeAgentRuntime.factory(baseContext);
    const run = vi.fn().mockResolvedValue({ started: true, threadId: 'thread-1' });
    const result = runtime.callSubAgent(
      { description: 'Research', instruction: 'Find the answer', timeout },
      { ...baseContext, subAgent: { run } } as ToolExecutionContext,
    );
    return { result, run };
  };

  it.each([undefined, 0, -1, Number.NaN])('falls back to the default for %s', async (timeout) => {
    const { result, run } = call(timeout);
    await result;

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: DEFAULT_SUB_AGENT_TIMEOUT_MS }),
    );
  });

  it('passes an explicit timeout through', async () => {
    const { result, run } = call(5 * 60 * 1000);
    await result;

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ timeout: 5 * 60 * 1000 }));
  });

  it('rejects a timeout too short to be milliseconds', async () => {
    const { result, run } = call(300);

    await expect(result).resolves.toMatchObject({
      content: expect.stringContaining(String(MIN_SUB_AGENT_TIMEOUT_MS)),
      error: { code: 'INVALID_ARGUMENTS' },
      success: false,
    });
    expect(run).not.toHaveBeenCalled();
  });
});

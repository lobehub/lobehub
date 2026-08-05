import type { BuiltinToolContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { lobeAgentExecutor } from './index';

// The executor module pulls in renderer aliases (`@/services/notebook`,
// `@/store/notebook`) that don't resolve in this package's vitest env — stub them,
// same as `builtin-tool-local-system` does. Nothing here touches the notebook path.
vi.mock('@/services/notebook', () => ({ notebookService: {} }));
vi.mock('@/store/notebook', () => ({ useNotebookStore: { getState: () => ({}) } }));

const params = { description: 'research', instruction: 'go look it up' };

const createContext = (run: ReturnType<typeof vi.fn>) =>
  ({ messageId: 'tool-msg-1', subAgent: { run } }) as unknown as BuiltinToolContext;

describe('lobeAgentExecutor.callSubAgent', () => {
  // A client sub-agent's own messages live in an isolation thread the parent never
  // loads, so this tool row's `state` is the ONLY place its spend reaches the
  // parent's usage tray. Persisting tokens but not cost / the token split makes a
  // client sub-agent read as free — the server path's completion bridge writes all
  // five, and this one has to match.
  it('persists the full spend the runner reports, not just the token total', async () => {
    const run = vi.fn().mockResolvedValue({
      model: 'deepseek-v4-flash',
      result: 'done',
      success: true,
      threadId: 'thd_1',
      totalCost: 0.42,
      totalInputTokens: 4000,
      totalOutputTokens: 1000,
      totalToolCalls: 6,
      totalTokens: 5000,
    });

    const result = await lobeAgentExecutor.callSubAgent(params, createContext(run));

    expect(result.success).toBe(true);
    expect(result.state).toEqual({
      model: 'deepseek-v4-flash',
      threadId: 'thd_1',
      totalCost: 0.42,
      totalInputTokens: 4000,
      totalOutputTokens: 1000,
      totalToolCalls: 6,
      totalTokens: 5000,
    });
  });

  it('surfaces a failed run as a tool error without state', async () => {
    const run = vi.fn().mockResolvedValue({
      error: 'boom',
      result: '',
      success: false,
      threadId: '',
    });

    const result = await lobeAgentExecutor.callSubAgent(params, createContext(run));

    expect(result).toEqual({ content: 'boom', success: false });
  });

  it('fails when the runtime provides no sub-agent runner', async () => {
    const result = await lobeAgentExecutor.callSubAgent(
      params,
      {} as unknown as BuiltinToolContext,
    );

    expect(result.success).toBe(false);
  });
});

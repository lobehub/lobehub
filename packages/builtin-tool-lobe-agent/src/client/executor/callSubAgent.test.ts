import type { BuiltinToolContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { lobeAgentExecutor } from './index';

// The executor module pulls in renderer aliases (`@/services/notebook`,
// `@/store/notebook`) that don't resolve in this package's vitest env — stub them,
// same as `builtin-tool-local-system` does. Nothing here touches the notebook path.
vi.mock('@/services/notebook', () => ({ notebookService: {} }));
vi.mock('@/store/notebook', () => ({ useNotebookStore: { getState: () => ({}) } }));

const params = { description: 'research', instruction: 'go look it up' };

// Sub-agents only run server-side; the browser executor has no runtime to start
// one in, so it must report that as a tool error instead of throwing.
describe('lobeAgentExecutor.callSubAgent', () => {
  it('returns the not-available result without throwing', async () => {
    const result = await lobeAgentExecutor.callSubAgent(params, {
      messageId: 'tool-msg-1',
    } as unknown as BuiltinToolContext);

    expect(result).toEqual({
      content: 'Sub-agent execution is not available in this runtime.',
      success: false,
    });
  });

  it('returns the not-available result for a continuation request too', async () => {
    const result = await lobeAgentExecutor.callSubAgent({ ...params, subAgentId: 'thd_1' }, {
      messageId: 'tool-msg-1',
    } as unknown as BuiltinToolContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe('Sub-agent execution is not available in this runtime.');
  });

  it('refuses a nested sub-agent call from within a sub-agent', async () => {
    const result = await lobeAgentExecutor.callSubAgent(params, {
      isSubAgent: true,
      messageId: 'tool-msg-1',
    } as unknown as BuiltinToolContext);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ type: 'NestedSubAgentNotAllowed' });
  });
});

import { expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import type { ChatStore } from '@/store/chat/store';

import { PluginPublicApiActionImpl } from './publicApi';

vi.mock('@/services/message', () => ({ messageService: { assertToolDispatch: vi.fn() } }));
it('blocks a persisted gateway call before either executor when access was revoked', async () => {
  vi.mocked(messageService.assertToolDispatch).mockRejectedValue(new Error('tool access revoked'));
  const invokeMCPTypePlugin = vi.fn();
  const invokeBuiltinTool = vi.fn();
  const store = {
    dbMessagesMap: { topic: [{ id: 'tool1', agentId: 'agent', topicId: 'topic' }] },
    invokeMCPTypePlugin,
    invokeBuiltinTool,
  } as unknown as ChatStore;
  const actions = new PluginPublicApiActionImpl(vi.fn(), () => store);
  await expect(
    actions.internal_invokeDifferentTypePlugin('tool1', {
      id: 'call1',
      identifier: 'tool',
      apiName: 'run',
      arguments: '{}',
      type: 'builtin',
    }),
  ).rejects.toThrow('tool access revoked');
  expect(invokeMCPTypePlugin).not.toHaveBeenCalled();
  expect(invokeBuiltinTool).not.toHaveBeenCalled();
});

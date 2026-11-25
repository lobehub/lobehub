import { expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';

import { MessageService } from './index';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { message: { getContextReplays: { query: vi.fn() } } },
}));
it('loads private replay input under the document reader scope on every batch', async () => {
  vi.mocked(lambdaClient.message.getContextReplays.query).mockImplementation(async ({ agentId }) =>
    agentId === 'reader'
      ? {
          a1: {
            invocationId: 'a1',
            sessionKey: 'openai:gpt-4',
            version: 1,
            changes: [],
            sourceIds: [],
            system: [{ role: 'system', content: 'AUTHORIZED INPUT' }],
          },
        }
      : {},
  );
  const snapshots = await new MessageService().getContextReplays(
    Array.from({ length: 1001 }, (_, index) => `a${index}`),
    'reader',
  );
  expect(snapshots.a1.system?.[0].content).toBe('AUTHORIZED INPUT');
  expect(lambdaClient.message.getContextReplays.query).toHaveBeenCalledTimes(2);
});

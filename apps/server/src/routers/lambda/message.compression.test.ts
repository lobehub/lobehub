// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => ({}) }));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async (original) => ({
  ...(await original<object>()),
  cloudWorkspaceAuth: (opts: any) => opts.next({ ctx: opts.ctx }),
}));
vi.mock('./_helpers/conversationResourceGuard', () => ({ assertCanUseTopicTargets: vi.fn() }));
vi.mock('./_helpers/shareVisitorTargetGuard', () => ({ assertCreatorTopicTargets: vi.fn() }));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('@/server/services/message', () => ({
  MessageService: class {
    finalizeCompression = async (
      _id: string,
      _content: string,
      input: { sourceGroupIds?: string[] },
    ) => ({
      messages: input.sourceGroupIds?.includes('prior-summary')
        ? [{ id: 'new-summary' }]
        : [{ id: 'prior-summary' }, { id: 'new-summary' }],
      success: true,
    });
  },
}));

const { messageRouter } = await import('./message');
it('passes the selected prior groups through the public compression endpoint', async () => {
  const caller = messageRouter.createCaller({ userId: 'owner' } as never);
  const result = await caller.finalizeCompression({
    agentId: 'agent',
    topicId: 'topic',
    messageGroupId: 'new-summary',
    content: 'combined',
    sourceGroupIds: ['prior-summary'],
  });
  expect(result.messages).toEqual([{ id: 'new-summary' }]);
});

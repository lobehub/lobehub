// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { HumanApprovalAlreadyResolvedError } from '../../../models/message';
import { messagePlugins, messages, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageApprovalRepo } from '../index';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'message-approval-repo-user';
const otherUserId = 'message-approval-repo-other';
const repo = new MessageApprovalRepo(serverDB, userId);

const pending = { batchId: 'batch-1', itemIndex: 0, operationId: 'op-1', status: 'pending' };

const seedPendingTool = async (id: string, owner = userId) => {
  await serverDB.insert(messages).values({ content: 'before', id, role: 'tool', userId: owner });
  await serverDB.insert(messagePlugins).values({
    apiName: 'editFile',
    id,
    identifier: 'lobe-local-system',
    intervention: pending,
    state: { kept: true },
    toolCallId: `call-${id}`,
    userId: owner,
  });
};

const readRows = async (id: string) => {
  const [message] = await serverDB.select().from(messages).where(eq(messages.id, id));
  const [plugin] = await serverDB.select().from(messagePlugins).where(eq(messagePlugins.id, id));
  return { message, plugin };
};

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('MessageApprovalRepo', () => {
  it('publishes message content and plugin patch in one claim', async () => {
    await seedPendingTool('mar-claim');

    const result = await repo.resolve(
      [
        {
          content: 'approved',
          id: 'mar-claim',
          intervention: { resolutionRequestId: 'req-1', status: 'approved' },
          pluginState: { approvedBy: 'review' },
        },
      ],
      { publishResult: true },
    );

    expect(result).toBe('applied');
    const { message, plugin } = await readRows('mar-claim');
    expect(message.content).toBe('approved');
    expect(plugin.intervention).toEqual({
      ...pending,
      resolutionRequestId: 'req-1',
      status: 'approved',
    });
    expect(plugin.state).toEqual({ approvedBy: 'review', kept: true });
  });

  it('claims without publishing content until publishResult is set', async () => {
    await seedPendingTool('mar-claim-only');

    await repo.resolve([
      {
        content: 'private result',
        id: 'mar-claim-only',
        intervention: { resolutionRequestId: 'req-2', status: 'approved' },
      },
    ]);

    const { message, plugin } = await readRows('mar-claim-only');
    expect(message.content).toBe('before');
    expect(plugin.intervention).toMatchObject({ resolutionRequestId: 'req-2', status: 'approved' });
  });

  it('rejects a second winner and fails closed on rows outside the scope', async () => {
    await seedPendingTool('mar-own');
    await seedPendingTool('mar-foreign', otherUserId);
    const claim = {
      id: 'mar-own',
      intervention: { resolutionRequestId: 'req-3', status: 'approved' },
    };
    await repo.resolve([claim]);

    await expect(
      repo.resolve([
        { ...claim, intervention: { resolutionRequestId: 'req-4', status: 'rejected' } },
      ]),
    ).rejects.toBeInstanceOf(HumanApprovalAlreadyResolvedError);
    await expect(
      repo.resolve([{ ...claim, content: 'stolen', id: 'mar-foreign' }], { publishResult: true }),
    ).rejects.toThrow('Plugin not found: mar-foreign');

    const foreign = await readRows('mar-foreign');
    expect(foreign.message.content).toBe('before');
    expect(foreign.plugin.intervention).toEqual(pending);
  });

  it('restores the pre-claim snapshot for the owning request', async () => {
    await seedPendingTool('mar-restore');
    await repo.resolve(
      [
        {
          content: 'approved',
          id: 'mar-restore',
          intervention: { resolutionRequestId: 'req-5', status: 'approved' },
        },
      ],
      { publishResult: true },
    );

    await repo.restore([
      {
        claimedResolutionRequestId: 'req-5',
        content: 'before',
        id: 'mar-restore',
        intervention: pending,
        pluginState: { kept: true },
      },
    ]);

    const { message, plugin } = await readRows('mar-restore');
    expect(message.content).toBe('before');
    expect(plugin.intervention).toEqual(pending);
    expect(plugin.state).toEqual({ kept: true });
  });
});

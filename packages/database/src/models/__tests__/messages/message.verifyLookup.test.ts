// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'verify-msg-lookup-user';
const otherUserId = 'verify-msg-lookup-other';
const messageModel = new MessageModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.delete(users).where(eq(users.id, otherUserId));
});

describe('MessageModel.findVerifyMessageByOperationId', () => {
  it('resolves the verify card by its verifyOperationId metadata', async () => {
    const created = await messageModel.create({
      content: '',
      metadata: { verifyOperationId: 'op-1' },
      role: 'verify',
    });

    const found = await messageModel.findVerifyMessageByOperationId('op-1');
    expect(found?.id).toBe(created.id);
    expect(found?.role).toBe('verify');
  });

  it('returns undefined for an unknown operation id', async () => {
    await messageModel.create({
      content: '',
      metadata: { verifyOperationId: 'op-1' },
      role: 'verify',
    });

    const found = await messageModel.findVerifyMessageByOperationId('op-unknown');
    expect(found).toBeUndefined();
  });

  it('does not match non-verify messages with the same metadata', async () => {
    await messageModel.create({
      content: 'hi',
      metadata: { verifyOperationId: 'op-2' },
      role: 'user',
    });

    const found = await messageModel.findVerifyMessageByOperationId('op-2');
    expect(found).toBeUndefined();
  });

  it('is scoped to the owning user', async () => {
    await messageModel.create({
      content: '',
      metadata: { verifyOperationId: 'op-3' },
      role: 'verify',
    });

    const asOther = await new MessageModel(serverDB, otherUserId).findVerifyMessageByOperationId(
      'op-3',
    );
    expect(asOther).toBeUndefined();
  });
});

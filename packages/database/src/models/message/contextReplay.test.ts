import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { messages, users } from '../../schemas';
import { MessageModel } from './index';

const db = await getTestDB();
const owner = 'context-replay-owner';
const other = 'context-replay-other';
const model = new MessageModel(db, owner);
const snapshot = (content: string) => ({
  changes: [],
  invocationId: 'context-assistant',
  sessionKey: 'openai:gpt-4',
  sourceIds: [],
  system: [{ content, role: 'system' as const }],
  version: 1 as const,
});

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]);
  await model.create({ content: '', role: 'assistant' }, 'context-assistant');
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, owner));
  await db.delete(users).where(eq(users.id, other));
});

it('commits one immutable snapshot and returns the same winner to concurrent retries', async () => {
  const [first, second] = await Promise.all([
    model.commitContextReplay('context-assistant', snapshot('first')),
    model.commitContextReplay('context-assistant', snapshot('second')),
  ]);
  expect(first).toEqual(second);
  const [row] = await db.select().from(messages).where(eq(messages.id, 'context-assistant'));
  expect(row.metadata?.contextReplay).toBeUndefined();
  expect((await model.getContextReplays(['context-assistant']))['context-assistant']).toEqual(
    first,
  );
  expect(await new MessageModel(db, other).getContextReplays(['context-assistant'])).toEqual({});
  expect(first.createdBy).toBe(owner);
});

it('refuses to attach an invocation snapshot to another message identity', async () => {
  await expect(
    model.commitContextReplay('context-assistant', {
      ...snapshot('bad'),
      invocationId: 'another-call',
    }),
  ).rejects.toThrow();
});

it('does not disclose or replace another author snapshot', async () => {
  await model.commitContextReplay('context-assistant', snapshot('private'));
  await expect(
    new MessageModel(db, other).commitContextReplay('context-assistant', snapshot('forged')),
  ).rejects.toThrow();
});

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import { MessageModel } from './index';

const db = await getTestDB();
const owner = 'context-scrub-owner';
const other = 'context-scrub-other';
const model = new MessageModel(db, owner);
const segment = (key: string, content: string, sourceIds: string[]) => ({
  key,
  messages: [{ content, id: `${key}:0`, role: 'user' as const }],
  sourceIds,
});
const commit = (target: MessageModel, id: string, system?: string) =>
  target.commitContextReplay(id, {
    changes: [
      segment('UserMemoryInjector', 'LIKES GREEN TEA', ['memory:preferences:m1']),
      segment('PersonaInjector', 'PERSONA NARRATIVE', ['memory-persona:rev1']),
      segment('ToolSystemRoleProvider', 'USE WEB SEARCH', ['tool:web']),
    ],
    invocationId: id,
    sessionKey: 'openai:gpt-4',
    sourceIds: ['memory:preferences:m1', 'memory-persona:rev1', 'tool:web', 'document:d1'],
    ...(system && { system: [{ content: system, role: 'system' as const }] }),
    version: 1,
  });
const stored = async (target: MessageModel, id: string) =>
  JSON.stringify((await target.getContextReplays([id]))[id]);

beforeEach(async () => {
  await db.insert(users).values([{ id: owner }, { id: other }]);
  await model.create({ content: '', role: 'assistant' }, 'scrub-assistant');
  await new MessageModel(db, other).create({ content: '', role: 'assistant' }, 'scrub-other');
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, owner));
  await db.delete(users).where(eq(users.id, other));
});

it('removes the rendered text of a deleted source and keeps the rest', async () => {
  await commit(model, 'scrub-assistant');
  await model.scrubContextReplaySources({ ids: ['memory:preferences:m1'] });
  const result = await stored(model, 'scrub-assistant');
  expect(result).not.toContain('LIKES GREEN TEA');
  expect(result).toContain('USE WEB SEARCH');
  expect(result).toContain('memory:preferences:m1');
});

it('removes every revision of a source family by prefix', async () => {
  await commit(model, 'scrub-assistant');
  await model.scrubContextReplaySources({ prefixes: ['memory-persona:'] });
  expect(await stored(model, 'scrub-assistant')).not.toContain('PERSONA NARRATIVE');
});

it('drops a baseline system prompt that rendered a deleted document', async () => {
  await commit(model, 'scrub-assistant', 'DOCUMENT IN SYSTEM');
  await model.scrubContextReplaySources({ ids: ['document:d1'] });
  expect(await stored(model, 'scrub-assistant')).not.toContain('DOCUMENT IN SYSTEM');
});

it("leaves another user's snapshots untouched", async () => {
  const otherModel = new MessageModel(db, other);
  await commit(otherModel, 'scrub-other');
  await model.scrubContextReplaySources({ ids: ['memory:preferences:m1'] });
  expect(await stored(otherModel, 'scrub-other')).toContain('LIKES GREEN TEA');
});

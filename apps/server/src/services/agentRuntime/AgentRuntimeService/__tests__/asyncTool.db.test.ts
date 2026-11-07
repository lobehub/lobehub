// @vitest-environment node
import type { AgentState } from '@lobechat/agent-runtime';
import { getTestDB } from '@lobechat/database/test-utils';
import type { ChatToolPayload } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { messagePlugins, messages, topics, users } from '@/database/schemas';

import type { AsyncToolDeps, PendingToolScope } from '../asyncTool';
import {
  checkPendingToolsBarrier,
  pendingToolScope,
  resolveAsyncToolOnComplete,
} from '../asyncTool';

const serverDB = await getTestDB();
const userId = 'async-tool-barrier-user';
const otherUserId = 'async-tool-barrier-other-user';
const topicId = 'async-tool-barrier-topic';

// Providers (and the acceptance mock upstream) can return the same id every turn.
const toolCallId = 'call_mock_1';
const pending = [{ id: toolCallId }] as ChatToolPayload[];

const deps = { serverDB, userId } as unknown as AsyncToolDeps;

let clock = Date.parse('2026-11-01T00:00:00Z');

const insertMessage = async (row: {
  content?: string;
  id: string;
  parentId?: string;
  role: string;
  topicId?: string;
  userId?: string;
}) => {
  clock += 1000;
  await serverDB.insert(messages).values({
    content: row.content ?? '',
    createdAt: new Date(clock),
    id: row.id,
    parentId: row.parentId,
    role: row.role,
    topicId: row.topicId ?? topicId,
    updatedAt: new Date(clock),
    userId: row.userId ?? userId,
  });
};

const insertToolRow = async (row: {
  content?: string;
  id: string;
  parentId: string;
  state?: Record<string, unknown>;
  topicId?: string;
  userId?: string;
}) => {
  await insertMessage({ ...row, role: 'tool' });
  await serverDB.insert(messagePlugins).values({
    id: row.id,
    state: row.state ?? { status: 'pending' },
    toolCallId,
    userId: row.userId ?? userId,
  });
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(topics).values([
    { id: topicId, userId },
    { id: `${topicId}-other`, userId: otherUserId },
  ]);

  // Earlier turn in the same topic: same tool_call_id, already completed.
  await insertMessage({ id: 'asst-turn-1', role: 'assistant' });
  await insertToolRow({
    content: 'previous turn result',
    id: 'tool-turn-1',
    parentId: 'asst-turn-1',
    state: { onComplete: 'finish', status: 'completed' },
  });

  // Current parked turn: its placeholder is still pending.
  await insertMessage({ id: 'asst-turn-2', role: 'assistant' });
  await insertToolRow({ id: 'tool-turn-2', parentId: 'asst-turn-2' });
});

afterEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

const currentTurn: PendingToolScope = { parentMessageId: 'asst-turn-2', topicId };

const completeCurrentTurn = () =>
  serverDB
    .update(messagePlugins)
    .set({ state: { status: 'completed' } })
    .where(eq(messagePlugins.id, 'tool-turn-2'));

describe('async-tool barrier lookup (database)', () => {
  it('ignores an earlier turn’s completed row that shares the tool_call_id', async () => {
    expect(await checkPendingToolsBarrier(deps, pending, currentTurn)).toBe('pending');

    await completeCurrentTurn();

    expect(await checkPendingToolsBarrier(deps, pending, currentTurn)).toBe('fulfilled');
  });

  it('scopes by the anchor the runtime recorded on the parked state', async () => {
    // The anchored row is the OLDER one, so neither the topic fallback nor an
    // unscoped lookup would pick it: only the recorded anchor does.
    await serverDB
      .update(messagePlugins)
      .set({ state: { status: 'pending' } })
      .where(eq(messagePlugins.id, 'tool-turn-1'));
    await serverDB.update(messages).set({ content: '' }).where(eq(messages.id, 'tool-turn-1'));
    await completeCurrentTurn();
    const parked = {
      origin: { topicId },
      pendingToolsCalling: pending,
      pendingToolsParentMessageId: 'asst-turn-1',
      status: 'waiting_for_async_tool',
    } as unknown as AgentState;

    expect(await checkPendingToolsBarrier(deps, pending, pendingToolScope(parked))).toBe('pending');
    expect(await checkPendingToolsBarrier(deps, pending, { topicId })).toBe('fulfilled');
  });

  it('reports a missing row separately from a pending one', async () => {
    expect(await checkPendingToolsBarrier(deps, pending, { parentMessageId: 'asst-unknown' })).toBe(
      'missing',
    );
  });

  it('ignores another user’s completed row that shares the tool_call_id', async () => {
    await insertMessage({
      id: 'asst-other-user',
      role: 'assistant',
      topicId: `${topicId}-other`,
      userId: otherUserId,
    });
    await insertToolRow({
      content: 'someone else',
      id: 'tool-other-user',
      parentId: 'asst-other-user',
      state: { status: 'completed' },
      topicId: `${topicId}-other`,
      userId: otherUserId,
    });

    expect(
      await checkPendingToolsBarrier(deps, pending, { parentMessageId: 'asst-other-user' }),
    ).toBe('missing');
  });

  it('prefers a reused tool row anchor over its completed children', async () => {
    // An approval resume parks on the tool row itself; a member anchor under
    // it may carry the same tool_call_id and finish first.
    await insertToolRow({
      content: 'member done',
      id: 'member-anchor',
      parentId: 'tool-turn-2',
      state: { status: 'completed' },
    });
    const reusedRow: PendingToolScope = { parentMessageId: 'tool-turn-2', topicId };

    expect(await checkPendingToolsBarrier(deps, pending, reusedRow)).toBe('pending');

    await completeCurrentTurn();

    expect(await checkPendingToolsBarrier(deps, pending, reusedRow)).toBe('fulfilled');
  });

  it('falls back to the newest row in the topic for ops parked without an anchor', async () => {
    expect(await checkPendingToolsBarrier(deps, pending, { topicId })).toBe('pending');
  });

  it('trusts the caller’s just-backfilled placeholder', async () => {
    expect(await checkPendingToolsBarrier(deps, pending, currentTurn, 'tool-turn-2')).toBe(
      'fulfilled',
    );
  });

  it('reads the finish disposition from the current turn only', async () => {
    expect(await resolveAsyncToolOnComplete(deps, pending, currentTurn)).toBe('resume');

    await serverDB
      .update(messagePlugins)
      .set({ state: { onComplete: 'finish', status: 'pending' } })
      .where(eq(messagePlugins.id, 'tool-turn-2'));

    expect(await resolveAsyncToolOnComplete(deps, pending, currentTurn)).toBe('finish');
  });
});

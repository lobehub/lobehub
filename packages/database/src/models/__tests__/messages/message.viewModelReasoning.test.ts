// @vitest-environment node
import { LOADING_FLAT } from '@lobechat/const';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'view-model-reasoning-user';
const topicId = 'vmr-topic';
const messageModel = new MessageModel(serverDB, userId);

describe('MessageModel viewModelReasoning (omitReasoningContent)', () => {
  beforeEach(async () => {
    await serverDB.delete(users).where(eq(users.id, userId));
    await serverDB.insert(users).values({ id: userId });
    await serverDB.insert(topics).values({ id: topicId, title: 'vmr', userId });
  });

  afterEach(async () => {
    await serverDB.delete(users).where(eq(users.id, userId));
  });

  it('omits reasoning content and signatures on settled rows while keeping live rows whole', async () => {
    await serverDB.insert(messages).values([
      {
        content: 'hello',
        createdAt: new Date('2026-11-28T00:00:00Z'),
        id: 'vmr-user',
        role: 'user',
        topicId,
        userId,
      },
      {
        content: 'final answer',
        createdAt: new Date('2026-11-28T00:00:01Z'),
        id: 'vmr-settled',
        parentId: 'vmr-user',
        reasoning: {
          content: 'long chain of thought '.repeat(100),
          duration: 3200,
          signature: 'sig-abc',
        },
        role: 'assistant',
        topicId,
        userId,
      },
      {
        content: '',
        createdAt: new Date('2026-11-28T00:00:02Z'),
        id: 'vmr-tool-step',
        parentId: 'vmr-settled',
        reasoning: {
          content: 'deciding which tool to call',
          duration: 850,
          isMultimodal: false,
        },
        role: 'assistant',
        tools: [
          { apiName: 'search', arguments: '{}', id: 'tc_1', identifier: 'web', type: 'default' },
        ],
        topicId,
        userId,
      },
      {
        content: 'answer with signature only',
        createdAt: new Date('2026-11-28T00:00:03Z'),
        id: 'vmr-sig-only',
        parentId: 'vmr-tool-step',
        reasoning: { signature: 'opaque-only' },
        role: 'assistant',
        topicId,
        userId,
      },
      {
        content: 'answer with whitespace-only reasoning',
        createdAt: new Date('2026-11-28T00:00:03.500Z'),
        id: 'vmr-whitespace',
        parentId: 'vmr-sig-only',
        reasoning: { content: '\n\t \u00A0\u202F\uFEFF \r\n' },
        role: 'assistant',
        topicId,
        userId,
      },
      {
        content: LOADING_FLAT,
        createdAt: new Date('2026-11-28T00:00:04Z'),
        id: 'vmr-streaming',
        parentId: 'vmr-whitespace',
        reasoning: { content: 'still thinking...', duration: 400 },
        role: 'assistant',
        topicId,
        userId,
      },
    ]);

    const projected = await messageModel.query({ omitReasoningContent: true, topicId });
    const byId = new Map(projected.map((m) => [m.id, m]));

    expect(byId.get('vmr-settled')?.reasoning).toEqual({
      contentOmitted: true,
      duration: 3200,
    });
    expect(byId.get('vmr-tool-step')?.reasoning).toEqual({
      contentOmitted: true,
      duration: 850,
      isMultimodal: false,
    });
    // Protocol-only rows keep a tiny `protocolOmitted` marker so lossless export
    // and browser replay know to fetch them, while UI cards stay hidden.
    expect(byId.get('vmr-sig-only')?.reasoning).toEqual({ protocolOmitted: true });
    // Whitespace-only reasoning (tabs/newlines) projects to null, matching JS .trim().
    expect(byId.get('vmr-whitespace')?.reasoning).toBeFalsy();
    // In-progress streaming rows keep their full reasoning.
    expect(byId.get('vmr-streaming')?.reasoning).toEqual({
      content: 'still thinking...',
      duration: 400,
    });

    // Cursor read applies the exact same SQL projection.
    const cursorPage = await messageModel.queryTopicMessagesByCursor({
      omitReasoningContent: true,
      topicId,
    });
    const cursorById = new Map(cursorPage.messages.map((m) => [m.id, m]));
    expect(cursorById.get('vmr-settled')?.reasoning).toEqual({
      contentOmitted: true,
      duration: 3200,
    });

    // On-demand `findReasoningByIds` restores the full stored reasoning.
    const restored = await messageModel.findReasoningByIds(['vmr-settled', 'vmr-user']);
    expect(restored['vmr-settled']).toEqual({
      content: 'long chain of thought '.repeat(100),
      duration: 3200,
      signature: 'sig-abc',
    });
    expect(restored['vmr-user']).toBeUndefined();

    // User isolation: another user cannot read this user's stored reasoning.
    const otherModel = new MessageModel(serverDB, 'other-view-model-reasoning-user');
    expect(await otherModel.findReasoningByIds(['vmr-settled'])).toEqual({});
  });
});

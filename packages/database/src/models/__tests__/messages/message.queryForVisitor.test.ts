// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { messages, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel, sanitizeVisitorError, toVisitorMessage } from '../../message';

const serverDB: LobeChatDatabase = await getTestDB();

// `queryForVisitor` is read under the CREATOR's account scope (agent-share
// visitor reads run `new MessageModel(db, share.ownerId)`), matching the
// production shareChat.ts caller.
const creatorId = 'visitor-dto-creator';
const visitorId = 'visitor-dto-visitor';
const testUserIds = [creatorId, visitorId];

const cleanup = async () => {
  await serverDB.delete(users).where(inArray(users.id, testUserIds));
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([
    {
      id: creatorId,
      avatar: 'https://example.com/creator-avatar.png',
      fullName: 'Creator Full Name',
      username: 'creator-handle',
    },
    { id: visitorId },
  ]);
});

afterEach(cleanup);

describe('MessageModel.queryForVisitor', () => {
  it('never forwards the creator sender identity or spend/model snapshot', async () => {
    const topicId = 'visitor-dto-topic';
    await serverDB.insert(topics).values({
      id: topicId,
      title: 'Share topic',
      userId: creatorId,
      senderId: visitorId,
    });
    await serverDB.insert(messages).values([
      {
        id: 'visitor-dto-user-message',
        content: 'hello agent',
        createdAt: new Date('2026-01-01'),
        role: 'user',
        topicId,
        userId: creatorId,
      },
      {
        id: 'visitor-dto-assistant-message',
        content: 'hello human',
        createdAt: new Date('2026-01-02'),
        // Legacy-shaped metadata: pre-migration rows carried usage/cost
        // under `metadata` instead of the dedicated `usage` column (see
        // `MessageMetadata`'s JSDoc). Asserted below alongside the
        // top-level/`extra` snapshot so this test actually exercises every
        // place the creator's spend data can hide, not just the one the
        // previous version of this test happened to check.
        metadata: { cost: 0.42, usage: { totalTokens: 999 } } as any,
        model: 'gpt-4',
        provider: 'openai',
        role: 'assistant',
        topicId,
        usage: { totalTokens: 999 } as any,
        userId: creatorId,
      },
    ]);

    // Mirrors shareChat.ts: the model is scoped to the CREATOR's account.
    const creatorScopedModel = new MessageModel(serverDB, creatorId);
    const result = await creatorScopedModel.queryForVisitor({ topicId });

    expect(result).toHaveLength(2);
    for (const message of result) {
      // The creator's account identity must never cross the share boundary.
      expect(message.sender).toBeNull();
      expect(message.usage).toBeUndefined();
      expect(message.works).toBeUndefined();
      // The creator's exact model/provider choice — top level AND the
      // `extra` duplicate populated by `queryWithWhere`. The previous
      // version of this test asserted `extra.model`/`extra.provider` only,
      // which let the top-level duplicate (the actual Codex P2 finding on
      // `message.ts:425`) reach the visitor DTO undetected.
      expect(message.model).toBeUndefined();
      expect(message.provider).toBeUndefined();
      expect(message.extra?.model).toBeUndefined();
      expect(message.extra?.provider).toBeUndefined();
    }

    // Visitor-facing rendering fields survive the redaction.
    const userMessage = result.find((item) => item.id === 'visitor-dto-user-message');
    const assistantMessage = result.find((item) => item.id === 'visitor-dto-assistant-message');
    expect(userMessage?.content).toBe('hello agent');
    expect(userMessage?.role).toBe('user');
    expect(assistantMessage?.content).toBe('hello human');
    expect(assistantMessage?.role).toBe('assistant');
    // Legacy `metadata.usage`/`metadata.cost` must not survive either.
    expect((assistantMessage?.metadata as any)?.usage).toBeUndefined();
    expect((assistantMessage?.metadata as any)?.cost).toBeUndefined();
  });

  it('still exposes the creator identity through the raw query() path (regression guard)', async () => {
    // Guards the premise of the fix above: without `queryForVisitor`, `query()`
    // hydrates the creator's account into `sender` — this is the vulnerable
    // path shareChat.ts must never call directly for visitor reads.
    const topicId = 'visitor-dto-raw-topic';
    await serverDB.insert(topics).values({
      id: topicId,
      title: 'Share topic',
      userId: creatorId,
      senderId: visitorId,
    });
    await serverDB.insert(messages).values({
      id: 'visitor-dto-raw-message',
      content: 'hello agent',
      createdAt: new Date('2026-01-01'),
      role: 'user',
      topicId,
      userId: creatorId,
    });

    const creatorScopedModel = new MessageModel(serverDB, creatorId);
    const [rawMessage] = await creatorScopedModel.query({ topicId });

    expect(rawMessage.sender).toEqual({
      avatar: 'https://example.com/creator-avatar.png',
      fullName: 'Creator Full Name',
      id: creatorId,
      username: 'creator-handle',
    });
  });
});

describe('toVisitorMessage — nested messages', () => {
  it('sanitizes messages nested under a compressed group and group members', () => {
    const creatorSender = {
      avatar: 'https://example.com/avatar.png',
      fullName: 'Creator Name',
      id: 'creator-user-id',
      username: 'creator',
    };

    const sanitized = toVisitorMessage({
      // `compareGroup` nodes carry the same bare model/provider snapshot
      // under `children` as `pinnedMessages` (see `queryMessageGroupNodes`)
      // — the previous version of this fixture never exercised this leak
      // path at all, so it went unredacted until this fix.
      children: [
        {
          content: 'candidate reply',
          createdAt: 1,
          id: 'candidate-1',
          model: 'gpt-4',
          provider: 'openai',
          role: 'assistant',
        },
      ] as any,
      compressedMessages: [
        {
          // Top-level `model`/`provider` are what `queryWithWhere` actually
          // populates on every real row (see `message.ts` transform step) —
          // the previous fixture only set them under `extra`, which is why
          // the top-level leak (Codex P2 on `message.ts:425`) went
          // undetected despite this test's name.
          content: 'compacted turn',
          createdAt: 1,
          extra: { model: 'gpt-4', provider: 'openai' },
          id: 'inner-1',
          model: 'gpt-4',
          provider: 'openai',
          role: 'assistant',
          sender: creatorSender,
          updatedAt: 1,
          usage: { totalTokens: 42 },
        },
      ] as any,
      content: 'compressed',
      createdAt: 1,
      id: 'group-1',
      members: [
        {
          content: 'member turn',
          createdAt: 1,
          id: 'member-1',
          model: 'gpt-4',
          provider: 'openai',
          role: 'assistant',
          sender: creatorSender,
          updatedAt: 1,
          usage: { totalTokens: 7 },
        },
      ] as any,
      pinnedMessages: [
        {
          content: 'pinned',
          createdAt: new Date(),
          id: 'pinned-1',
          model: 'gpt-4',
          provider: 'openai',
          role: 'assistant',
        },
      ],
      role: 'compressedGroup',
      updatedAt: 1,
    } as any);

    expect(sanitized.compressedMessages?.[0].sender).toBeNull();
    expect(sanitized.compressedMessages?.[0].usage).toBeUndefined();
    expect(sanitized.compressedMessages?.[0].model).toBeUndefined();
    expect(sanitized.compressedMessages?.[0].provider).toBeUndefined();
    expect(sanitized.compressedMessages?.[0].extra?.model).toBeUndefined();
    expect(sanitized.compressedMessages?.[0].extra?.provider).toBeUndefined();
    expect(sanitized.members?.[0].sender).toBeNull();
    expect(sanitized.members?.[0].usage).toBeUndefined();
    expect(sanitized.members?.[0].model).toBeUndefined();
    expect(sanitized.members?.[0].provider).toBeUndefined();
    expect(sanitized.pinnedMessages?.[0].model).toBeNull();
    expect(sanitized.pinnedMessages?.[0].provider).toBeNull();
    expect((sanitized.children?.[0] as any).model).toBeNull();
    expect((sanitized.children?.[0] as any).provider).toBeNull();
    // Content is preserved — only creator-only metadata is stripped.
    expect(sanitized.compressedMessages?.[0].content).toBe('compacted turn');
    expect((sanitized.children?.[0] as any).content).toBe('candidate reply');
  });

  it('never forwards the top-level model/provider snapshot on a plain message', () => {
    // This is the exact shape `queryWithWhere` produces for every real row
    // (top-level `model`/`provider` re-added after the `extra` spread — see
    // `message.ts`'s transform step): the field the old version of this test
    // suite never constructed, and therefore never caught leaking.
    const sanitized = toVisitorMessage({
      content: 'hello human',
      createdAt: 1,
      extra: { model: 'gpt-4', provider: 'openai' },
      id: 'plain-1',
      model: 'gpt-4',
      provider: 'openai',
      role: 'assistant',
      updatedAt: 1,
    } as any);

    expect(sanitized.model).toBeUndefined();
    expect(sanitized.provider).toBeUndefined();
    expect(sanitized.extra?.model).toBeUndefined();
    expect(sanitized.extra?.provider).toBeUndefined();
    expect(sanitized.content).toBe('hello human');
  });
});

describe('toVisitorMessage — nested blobs (Codex P2, LOBE-11930 message.ts:440)', () => {
  it('redacts model/provider/usage nested inside pluginState (lobe-agent analyzeMedia)', () => {
    // Exact shape written by `analyzeMedia`'s server runtime — see
    // `apps/server/src/services/toolExecution/serverRuntimes/lobeAgent.ts`'s
    // `analyzeMedia` return value (`state: { files, model, provider, trigger,
    // usage }`). `pluginState` used to be a plain allowlist entry, which
    // forwarded this verbatim to a share visitor.
    const sanitized = toVisitorMessage({
      content: 'analyzed the attached image',
      createdAt: 1,
      id: 'tool-analyze-media',
      pluginState: {
        files: [{ id: 'file-1', name: 'photo.png', ref: 'img-1', type: 'image' }],
        model: 'gpt-4o',
        provider: 'openai',
        trigger: 'multimodalAnalysis',
        usage: { totalTokens: 512 },
      },
      role: 'tool',
      updatedAt: 1,
    } as any);

    expect(sanitized.pluginState.model).toBeUndefined();
    expect(sanitized.pluginState.provider).toBeUndefined();
    expect(sanitized.pluginState.usage).toBeUndefined();
    // Visitor-facing tool result metadata (which files were analyzed) survives.
    expect(sanitized.pluginState.trigger).toBe('multimodalAnalysis');
    expect(sanitized.pluginState.files).toEqual([
      { id: 'file-1', name: 'photo.png', ref: 'img-1', type: 'image' },
    ]);
  });

  it('redacts creator-private keys nested arbitrarily deep inside pluginState/pluginError', () => {
    const sanitized = toVisitorMessage({
      content: '',
      createdAt: 1,
      id: 'tool-deep-nesting',
      pluginError: {
        cause: { cost: 1.23, message: 'upstream failure', provider: 'anthropic' },
        message: 'failed',
      },
      pluginState: {
        nested: { deeper: { model: 'claude-4', totalTokens: 99 } },
        ok: true,
        steps: [{ model: 'gpt-4o', name: 'step-1' }],
      },
      role: 'tool',
      updatedAt: 1,
    } as any);

    expect(sanitized.pluginState.nested.deeper.model).toBeUndefined();
    expect(sanitized.pluginState.nested.deeper.totalTokens).toBeUndefined();
    expect(sanitized.pluginState.steps[0].model).toBeUndefined();
    expect(sanitized.pluginState.steps[0].name).toBe('step-1');
    expect(sanitized.pluginState.ok).toBe(true);
    expect(sanitized.pluginError.cause.cost).toBeUndefined();
    expect(sanitized.pluginError.cause.provider).toBeUndefined();
    expect(sanitized.pluginError.cause.message).toBe('upstream failure');
    expect(sanitized.pluginError.message).toBe('failed');
  });

  it('redacts model/provider from signalCallbacks and usage from taskCompletions', () => {
    // Both blocks are denormalized by `FlatListBuilder`
    // (`packages/conversation-flow`) directly onto virtual assistantGroup/
    // supervisor messages — never covered by the `pinnedMessages`/`children`
    // group-snapshot fix despite carrying the same class of data.
    const sanitized = toVisitorMessage({
      content: '',
      createdAt: 1,
      id: 'assistant-group-1',
      role: 'assistantGroup',
      signalCallbacks: [
        {
          callbacks: [
            { content: 'callback reply', id: 'cb-1', model: 'gpt-4o', provider: 'openai' },
          ],
          sourceToolCallId: 'call-1',
          sourceToolMessageId: 'tool-msg-1',
          sourceToolName: 'lobe-web-browsing',
        },
      ],
      taskCompletions: [
        {
          content: 'summary of the task',
          id: 'summary-1',
          usage: { totalTokens: 321 },
        },
      ],
      updatedAt: 1,
    } as any);

    expect(sanitized.signalCallbacks?.[0].callbacks[0].model).toBeUndefined();
    expect(sanitized.signalCallbacks?.[0].callbacks[0].provider).toBeUndefined();
    expect(sanitized.signalCallbacks?.[0].callbacks[0].content).toBe('callback reply');
    expect((sanitized.taskCompletions?.[0] as any).usage).toBeUndefined();
    expect(sanitized.taskCompletions?.[0].content).toBe('summary of the task');
  });
});

describe('toVisitorMessage — error projection (Codex P2, LOBE-11930 message.ts:432)', () => {
  // `error` used to be a plain entry in `VISITOR_MESSAGE_ALLOWED_KEYS` — the
  // same "field is safe, contents are not" mistake as `pluginState`.
  // `formatErrorForState` (`apps/server/src/modules/AgentRuntime/formatErrorForState.ts`)
  // deliberately copies `provider`/`budget`/the raw upstream response body
  // onto `ChatMessageError.body` for exactly the failures a visitor can
  // trigger on demand (bad key, exhausted quota, upstream 500).

  it('projects a provider-biz error to the public bucket, dropping body entirely', () => {
    const sanitized = toVisitorMessage({
      content: '',
      createdAt: 1,
      error: {
        body: {
          _responseBody: { error: { message: 'Invalid Authentication' } },
          provider: 'openai',
        },
        message: 'Invalid Authentication',
        type: 'InvalidProviderAPIKey',
      },
      id: 'error-provider-biz',
      role: 'assistant',
      updatedAt: 1,
    } as any);

    expect(sanitized.error?.type).toBe('AgentRuntimeError');
    expect(sanitized.error?.message).toBeUndefined();
    expect((sanitized.error as any)?.body).toBeUndefined();
    expect(JSON.stringify(sanitized.error)).not.toContain('openai');
    expect(JSON.stringify(sanitized.error)).not.toContain('Invalid Authentication');
  });

  it('projects a quota/budget error to the public bucket, dropping the budget snapshot', () => {
    const sanitized = toVisitorMessage({
      content: '',
      createdAt: 1,
      error: {
        body: { budget: { limit: 10, remaining: 0 } },
        message: 'LobeHub Cloud balance is too low for this model.',
        type: 'InsufficientBudgetForModel',
      },
      id: 'error-budget',
      role: 'assistant',
      updatedAt: 1,
    } as any);

    expect(sanitized.error?.type).toBe('AgentRuntimeError');
    expect((sanitized.error as any)?.body).toBeUndefined();
    expect(JSON.stringify(sanitized.error)).not.toContain('balance');
    expect(JSON.stringify(sanitized.error)).not.toContain('remaining');
  });

  it('forwards a share-purpose-built safe error code verbatim (type + message), still dropping body', () => {
    const sanitized = toVisitorMessage({
      content: '',
      createdAt: 1,
      error: {
        body: { internalDebugField: 'do-not-leak' },
        message: 'You have reached the turn limit for this topic. Start a new topic to continue.',
        type: 'ShareTurnLimitExceeded',
      },
      id: 'error-share-safe',
      role: 'assistant',
      updatedAt: 1,
    } as any);

    expect(sanitized.error?.type).toBe('ShareTurnLimitExceeded');
    expect(sanitized.error?.message).toBe(
      'You have reached the turn limit for this topic. Start a new topic to continue.',
    );
    expect((sanitized.error as any)?.body).toBeUndefined();
  });

  it('sanitizeVisitorError passes through null/undefined unchanged', () => {
    expect(sanitizeVisitorError(undefined)).toBeUndefined();
    expect(sanitizeVisitorError(null)).toBeNull();
  });
});

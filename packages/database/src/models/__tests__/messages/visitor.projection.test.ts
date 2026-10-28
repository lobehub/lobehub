// @vitest-environment node
import type { UIChatMessage } from '@lobechat/types';
import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  redactCreatorPrivateBlob,
  sanitizeVisitorError,
  toVisitorMessage,
} from '../../message/visitor';

/** A message row as the share read hands it over, before the visitor projection. */
const message = (overrides: Record<string, unknown> = {}): UIChatMessage =>
  ({
    content: 'hello',
    createdAt: new Date('2026-10-26T00:00:00.000Z'),
    id: 'msg-1',
    role: 'assistant',
    sender: 'creator-account',
    ...overrides,
  }) as unknown as UIChatMessage;

const asRecords = (value: unknown): Array<Record<string, unknown>> =>
  value as Array<Record<string, unknown>>;

/** A `pinnedMessages` / `compareGroup` entry: the narrow projection the group-node read builds. */
const groupSnapshot = (id: string, content: string) => ({
  content,
  createdAt: 1,
  id,
  model: 'gpt-4o',
  provider: 'openai',
  role: 'assistant',
});

describe('redactCreatorPrivateBlob', () => {
  it('drops creator keys at every depth, arrays included', () => {
    const state = {
      keep: 'visible',
      model: 'gpt-4o',
      nested: { provider: 'openai', usage: { totalTokens: 12 }, value: 1 },
      steps: [{ totalCost: 0.4, label: 'step-1' }, { tokens: { inputTokens: 3 } }],
    };

    expect(redactCreatorPrivateBlob(state)).toEqual({
      keep: 'visible',
      nested: { value: 1 },
      steps: [{ label: 'step-1' }, { tokens: {} }],
    });
  });

  it('passes non-plain values through untouched', () => {
    const date = new Date('2026-10-26T00:00:00.000Z');
    const error = new Error('boom');

    expect(redactCreatorPrivateBlob(date)).toBe(date);
    expect(redactCreatorPrivateBlob(error)).toBe(error);
    expect(redactCreatorPrivateBlob('plain')).toBe('plain');
    expect(redactCreatorPrivateBlob(null)).toBeNull();
  });
});

describe('sanitizeVisitorError', () => {
  it('keeps an allowlisted business code readable', () => {
    const error = {
      message: 'This share hit its turn cap',
      type: ChatErrorType.ShareTurnLimitExceeded,
    };

    expect(sanitizeVisitorError(error)).toEqual(error);
  });

  it('projects every other code down to a generic type and drops the raw payload', () => {
    const sanitized = sanitizeVisitorError({
      body: { provider: 'openai', raw: 'invalid key sk-…' },
      message: 'OpenAI rejected the creator key',
      type: 'InvalidProviderAPIKey' as ChatErrorType,
    });

    expect(sanitized).toEqual({ type: AgentRuntimeErrorType.AgentRuntimeError });
  });

  it('passes the raw failure through when the share opted into details', () => {
    const error = { message: 'raw upstream body', type: 'UpstreamError' as ChatErrorType };

    expect(sanitizeVisitorError(error, { showErrorDetails: true })).toBe(error);
  });

  it('returns an absent error as-is', () => {
    expect(sanitizeVisitorError(undefined)).toBeUndefined();
    expect(sanitizeVisitorError(null)).toBeNull();
  });
});

describe('toVisitorMessage', () => {
  it('drops creator identity, model choice and spend by default', () => {
    const visitor = toVisitorMessage(
      message({
        extra: { model: 'gpt-4o', tts: { voice: 'alloy' }, translate: { to: 'zh-CN' } },
        metadata: { cost: 0.12, usage: { totalTokens: 9 }, workingDirectory: '/repo' },
        model: 'gpt-4o',
        pluginError: { body: 'x', provider: 'openai' },
        pluginState: { model: 'gpt-4o', tool: { name: 'search', usage: {} } },
        provider: 'openai',
        taskCompletions: [{ content: 'done', id: 'tc-1', usage: { totalTokens: 5 } }],
        taskDetail: {
          id: 'td-1',
          status: 'success',
          totalCost: 2,
          totalTokens: 30,
          totalToolCalls: 4,
        },
        usage: { totalTokens: 9 },
      }),
    );

    expect(visitor.sender).toBeNull();
    expect(visitor.model).toBeUndefined();
    expect(visitor.provider).toBeUndefined();
    expect(visitor.usage).toBeUndefined();
    expect(visitor.extra).toEqual({ translate: { to: 'zh-CN' }, tts: { voice: 'alloy' } });
    expect(visitor.metadata).toEqual({ workingDirectory: '/repo' });
    expect(visitor.pluginError).toEqual({ body: 'x' });
    expect(visitor.pluginState).toEqual({ tool: { name: 'search' } });
    expect(visitor.taskDetail).toEqual({ id: 'td-1', status: 'success' });
    expect(asRecords(visitor.taskCompletions)[0]).toEqual({ content: 'done', id: 'tc-1' });
  });

  it('keeps the model snapshot when the share opts in', () => {
    const visitor = toVisitorMessage(
      message({
        metadata: { usage: { totalTokens: 9 }, workingDirectory: '/repo' },
        model: 'gpt-4o',
        provider: 'openai',
        taskDetail: { id: 'td-1', usage: { totalTokens: 3 } },
        usage: { totalTokens: 9 },
      }),
      { showModelInfo: true },
    );

    expect(visitor.model).toBe('gpt-4o');
    expect(visitor.provider).toBe('openai');
    expect(visitor.usage).toEqual({ totalTokens: 9 });
    expect(visitor.metadata).toEqual({ usage: { totalTokens: 9 }, workingDirectory: '/repo' });
    expect(visitor.taskDetail).toEqual({ id: 'td-1', usage: { totalTokens: 3 } });
  });

  it('strips the per-callback model snapshot from signal callbacks', () => {
    const visitor = toVisitorMessage(
      message({
        signalCallbacks: [
          {
            callbacks: [
              { id: 'cb-1', model: 'gpt-4o', provider: 'openai', status: 'done' },
              { id: 'cb-2', model: 'claude', provider: 'anthropic', status: 'pending' },
            ],
            id: 'block-1',
          },
        ],
      }),
    );

    expect(visitor.signalCallbacks).toEqual([
      {
        callbacks: [
          { id: 'cb-1', model: undefined, provider: undefined, status: 'done' },
          { id: 'cb-2', model: undefined, provider: undefined, status: 'pending' },
        ],
        id: 'block-1',
      },
    ]);
  });

  it('nulls the spend snapshot on Work summaries while keeping the event', () => {
    const work = {
      event: { cumulativeCost: 1.2, cumulativeUsage: { totalTokens: 40 }, status: 'done' },
      sessionId: 'session-1',
      totalCost: 0.8,
      userId: 'creator-account',
      workspaceId: 'workspace-1',
    };

    const hidden = asRecords(toVisitorMessage(message({ works: [work] })).works)[0];
    expect(hidden).not.toHaveProperty('userId');
    expect(hidden).not.toHaveProperty('workspaceId');
    expect(hidden.totalCost).toBeNull();
    expect(hidden.event).toEqual({ cumulativeCost: null, cumulativeUsage: null, status: 'done' });

    const shown = asRecords(
      toVisitorMessage(message({ works: [work] }), { showModelInfo: true }).works,
    )[0];
    expect(shown).not.toHaveProperty('userId');
    expect(shown.totalCost).toBe(0.8);
  });

  it('nulls the model snapshot on group-node projections', () => {
    const visitor = toVisitorMessage(
      message({
        children: [groupSnapshot('child-1', 'first')],
        pinnedMessages: [groupSnapshot('pin-1', 'pinned')],
        role: 'compareGroup',
      }),
    );

    expect(asRecords(visitor.children)[0]).toMatchObject({ model: null, provider: null });
    expect(asRecords(visitor.pinnedMessages)[0]).toMatchObject({ model: null, provider: null });
  });

  it('recurses into a compareGroup that has model info sharing on', () => {
    const visitor = toVisitorMessage(
      message({
        children: [groupSnapshot('child-1', 'first')],
        role: 'compareGroup',
      }),
      { showModelInfo: true },
    );

    expect(asRecords(visitor.children)[0]).toMatchObject({ model: 'gpt-4o' });
  });

  it('recurses into nested assistantGroup children, members and compacted rows', () => {
    const nested = {
      content: 'nested',
      id: 'nested-1',
      model: 'gpt-4o',
      role: 'assistant',
      sender: 'creator-account',
    };

    const visitor = toVisitorMessage(
      message({
        children: [nested],
        compressedMessages: [{ ...nested, id: 'compressed-1' }],
        members: [{ ...nested, id: 'member-1' }],
        role: 'assistantGroup',
      }),
    );

    for (const rows of [visitor.children, visitor.compressedMessages, visitor.members]) {
      expect(asRecords(rows)[0]).toMatchObject({ model: undefined, sender: null });
    }
  });

  it('re-attaches a sanitized copy of a council broadcast', () => {
    const visitor = toVisitorMessage(
      message({
        council: [
          {
            content: 'member note',
            id: 'council-1',
            model: 'gpt-4o',
            role: 'assistant',
            sender: 'creator-account',
          },
        ],
      }),
    );

    expect((visitor as unknown as Record<string, unknown>).council).toEqual([
      expect.objectContaining({ content: 'member note', model: undefined, sender: null }),
    ]);
  });

  it('projects the error through the share error policy', () => {
    const raw = {
      message: 'OpenAI rejected the creator key',
      type: 'InvalidProviderAPIKey' as ChatErrorType,
    };

    expect(toVisitorMessage(message({ error: raw })).error).toEqual({
      type: AgentRuntimeErrorType.AgentRuntimeError,
    });
    expect(toVisitorMessage(message({ error: raw }), { showErrorDetails: true }).error).toBe(raw);
  });
});

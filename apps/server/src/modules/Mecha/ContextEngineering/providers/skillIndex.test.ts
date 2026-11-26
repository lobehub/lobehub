// @vitest-environment node
import type { SkillIndexSnapshot, SkillMeta } from '@lobechat/context-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveServerSkillIndex } from './skillIndex';

const { redisSkillIndexGet, redisSkillIndexSet } = vi.hoisted(() => ({
  redisSkillIndexGet: vi.fn(),
  redisSkillIndexSet: vi.fn(),
}));

vi.mock('@/server/services/redis', () => ({
  redisService: {
    skillIndex: {
      get: redisSkillIndexGet,
      set: redisSkillIndexSet,
    },
  },
}));

const TTL = 5 * 60 * 1000;
const at = (minute: number) => `2026-11-25T10:${String(minute).padStart(2, '0')}:00.000Z`;

const skill = (id: string, name: string, description: string): SkillMeta => ({
  description,
  identifier: id,
  name,
});

describe('resolveServerSkillIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisSkillIndexGet.mockResolvedValue(undefined);
    redisSkillIndexSet.mockResolvedValue(undefined);
  });

  it('takes a fresh snapshot on turn 1, binds it, and stores it in Redis', async () => {
    const bindSkillIndex = vi.fn();
    const snapshot = await resolveServerSkillIndex({
      agentId: 'agent-1',
      ctx: { bindSkillIndex, topicId: 'topic-1' } as never,
      skills: [skill('doc-writer', 'doc-writer', 'Writes docs')],
      state: { origin: { topicId: 'topic-1' } } as never,
      turn: {
        cacheTtlMs: TTL,
        messages: [{ createdAt: at(0), id: 'u1', role: 'user' }],
      },
    });

    expect(redisSkillIndexGet).toHaveBeenCalledWith({
      agentId: 'agent-1',
      threadId: undefined,
      topicId: 'topic-1',
    });
    expect(bindSkillIndex).toHaveBeenCalledWith(snapshot);
    expect(redisSkillIndexSet).toHaveBeenCalledWith(
      { agentId: 'agent-1', threadId: undefined, topicId: 'topic-1' },
      snapshot,
    );
    expect(snapshot.rows).toEqual([
      { description: 'Writes docs', identifier: 'doc-writer', name: 'doc-writer' },
    ]);
  });

  it('continues a warm stored snapshot from Redis and records added skills on the new user message', async () => {
    const stored: SkillIndexSnapshot = {
      notes: [],
      rows: [],
      takenAt: at(0),
    };
    redisSkillIndexGet.mockResolvedValue(stored);
    const bindSkillIndex = vi.fn();

    const snapshot = await resolveServerSkillIndex({
      agentId: 'agent-1',
      ctx: { bindSkillIndex, topicId: 'topic-1' } as never,
      skills: [skill('url-memo', 'q4-helper', 'Writes memos')],
      state: { origin: { topicId: 'topic-1' } } as never,
      turn: {
        cacheTtlMs: TTL,
        messages: [
          { createdAt: at(0), id: 'u1', role: 'user' },
          { createdAt: at(1), id: 'a1', role: 'assistant' },
          { createdAt: at(2), id: 'u2', role: 'user' },
        ],
      },
    });

    expect(snapshot.rows).toEqual([]);
    expect(snapshot.notes).toEqual([
      {
        changes: [
          {
            description: 'Writes memos',
            identifier: 'url-memo',
            kind: 'added',
            name: 'q4-helper',
          },
        ],
        messageId: 'u2',
      },
    ]);
    expect(bindSkillIndex).toHaveBeenCalledWith(snapshot);
    expect(redisSkillIndexSet).toHaveBeenCalledWith(
      { agentId: 'agent-1', threadId: undefined, topicId: 'topic-1' },
      snapshot,
    );
  });

  it('reuses a pinned snapshot mid-run without hitting Redis or re-binding', async () => {
    const pinned: SkillIndexSnapshot = {
      notes: [],
      rows: [{ description: 'Writes docs', identifier: 'doc-writer', name: 'doc-writer' }],
      takenAt: at(0),
    };
    const bindSkillIndex = vi.fn();

    const snapshot = await resolveServerSkillIndex({
      agentId: 'agent-1',
      ctx: { bindSkillIndex, topicId: 'topic-1' } as never,
      skills: [skill('url-memo', 'q4-helper', 'Writes memos')],
      state: { binding: { skillIndex: pinned }, origin: { topicId: 'topic-1' } } as never,
      turn: {
        cacheTtlMs: TTL,
        messages: [{ createdAt: at(0), id: 'u1', role: 'user' }],
      },
    });

    expect(snapshot).toBe(pinned);
    expect(redisSkillIndexGet).not.toHaveBeenCalled();
    expect(redisSkillIndexSet).not.toHaveBeenCalled();
    expect(bindSkillIndex).not.toHaveBeenCalled();
  });
});

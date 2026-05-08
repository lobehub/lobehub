// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createProcedureStateService } from '@/server/services/agentSignal/services/procedureStateService';
import type { AgentSignalPolicyStateStore } from '@/server/services/agentSignal/store/types';

import { readDeferredSkillCandidate, writeDeferredSkillCandidate } from '../skillCandidate';

const createStore = (): AgentSignalPolicyStateStore => {
  const state = new Map<string, Record<string, string>>();

  return {
    readPolicyState: async (policyId, scopeKey) => state.get(`${policyId}:${scopeKey}`),
    writePolicyState: async (policyId, scopeKey, data) => {
      const key = `${policyId}:${scopeKey}`;
      state.set(key, { ...state.get(key), ...data });
    },
  };
};

describe('deferred skill candidates', () => {
  /**
   * @example
   * User-stage direct skill intent persists as candidate state for completion-stage decisions.
   */
  it('writes and reads one deferred skill candidate by source id', async () => {
    const store = createStore();

    await writeDeferredSkillCandidate(store, {
      candidate: {
        actionIntent: 'create',
        confidence: 0.86,
        createdAt: 1000,
        explicitness: 'implicit_strong_learning',
        feedbackMessageId: 'msg_1',
        reason: 'future workflow reuse',
        route: 'direct_decision',
        scopeKey: 'topic:topic_1',
        sourceId: 'source_1',
      },
      scopeKey: 'topic:topic_1',
      ttlSeconds: 60,
    });

    await expect(
      readDeferredSkillCandidate(store, {
        scopeKey: 'topic:topic_1',
        sourceId: 'source_1',
      }),
    ).resolves.toEqual({
      actionIntent: 'create',
      confidence: 0.86,
      createdAt: 1000,
      explicitness: 'implicit_strong_learning',
      feedbackMessageId: 'msg_1',
      reason: 'future workflow reuse',
      route: 'direct_decision',
      scopeKey: 'topic:topic_1',
      sourceId: 'source_1',
    });
  });

  /**
   * @example
   * Corrupt candidate JSON is ignored instead of crashing policy execution.
   */
  it('returns undefined for malformed candidate JSON', async () => {
    const store = {
      readPolicyState: vi.fn().mockResolvedValue({
        'skill-candidate:source_1': '{bad-json',
      }),
      writePolicyState: vi.fn(),
    } satisfies AgentSignalPolicyStateStore;

    await expect(
      readDeferredSkillCandidate(store, {
        scopeKey: 'topic:topic_1',
        sourceId: 'source_1',
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * @example
   * Candidate JSON with missing required fields is ignored instead of becoming policy input.
   */
  it('returns undefined for malformed candidate objects', async () => {
    const store = {
      readPolicyState: vi.fn().mockResolvedValue({
        'skill-candidate:source_1': JSON.stringify({ sourceId: 'source_1' }),
      }),
      writePolicyState: vi.fn(),
    } satisfies AgentSignalPolicyStateStore;

    await expect(
      readDeferredSkillCandidate(store, {
        scopeKey: 'topic:topic_1',
        sourceId: 'source_1',
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * @example
   * Candidate payloads must match the requested source id and scope key after parsing.
   */
  it('returns undefined when parsed candidate identity does not match the read input', async () => {
    const store = {
      readPolicyState: vi.fn().mockResolvedValue({
        'skill-candidate:source_1': JSON.stringify({
          createdAt: 1000,
          explicitness: 'explicit_action',
          feedbackMessageId: 'msg_1',
          route: 'direct_decision',
          scopeKey: 'topic:topic_2',
          sourceId: 'source_2',
        }),
      }),
      writePolicyState: vi.fn(),
    } satisfies AgentSignalPolicyStateStore;

    await expect(
      readDeferredSkillCandidate(store, {
        scopeKey: 'topic:topic_1',
        sourceId: 'source_1',
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * @example
   * Same source ids in different runtime scopes do not read each other's candidates.
   */
  it('keeps candidates separated by scope key', async () => {
    const store = createStore();

    await writeDeferredSkillCandidate(store, {
      candidate: {
        confidence: 0.72,
        createdAt: 1000,
        explicitness: 'explicit_action',
        feedbackMessageId: 'msg_1',
        reason: 'store only in topic one',
        route: 'direct_decision',
        scopeKey: 'topic:topic_1',
        sourceId: 'source_1',
      },
      scopeKey: 'topic:topic_1',
      ttlSeconds: 60,
    });

    await expect(
      readDeferredSkillCandidate(store, {
        scopeKey: 'topic:topic_2',
        sourceId: 'source_1',
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * @example
   * ProcedureStateService.skillCandidates.write(candidate) applies facade-owned TTL and scope.
   */
  it('wires skill candidate helpers through ProcedureStateService', async () => {
    const writePolicyState = vi.fn(async () => {});
    const store = {
      readPolicyState: vi.fn().mockResolvedValue({
        'skill-candidate:source_1': JSON.stringify({
          confidence: 0.7,
          createdAt: 1000,
          explicitness: 'explicit_action',
          feedbackMessageId: 'msg_1',
          reason: 'facade read',
          route: 'direct_decision',
          scopeKey: 'topic:topic_1',
          sourceId: 'source_1',
        }),
      }),
      writePolicyState,
    } satisfies AgentSignalPolicyStateStore;
    const service = createProcedureStateService({
      policyStateStore: store,
      ttlSeconds: 90,
    });

    await service.skillCandidates.write({
      confidence: 0.7,
      createdAt: 1000,
      explicitness: 'explicit_action',
      feedbackMessageId: 'msg_1',
      reason: 'facade write',
      route: 'direct_decision',
      scopeKey: 'topic:topic_1',
      sourceId: 'source_1',
    });

    expect(writePolicyState).toHaveBeenCalledWith(
      'analyze-intent:skill-candidates',
      'topic:topic_1',
      expect.objectContaining({
        'skill-candidate:source_1': expect.any(String),
      }),
      90,
    );
    await expect(
      service.skillCandidates.read({
        scopeKey: 'topic:topic_1',
        sourceId: 'source_1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        feedbackMessageId: 'msg_1',
        sourceId: 'source_1',
      }),
    );
  });
});

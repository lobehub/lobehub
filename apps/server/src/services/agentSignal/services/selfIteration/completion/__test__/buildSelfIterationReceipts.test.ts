import { LayersEnum } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { AgentSignalOperationMarker } from '@/server/services/agentSignal/operationMarker';

import type { ToolResultWithKind } from '../../finalStateExtractor';
import { buildSelfIterationReceipts } from '../buildSelfIterationReceipts';

const marker: AgentSignalOperationMarker = {
  anchorMessageId: 'msg_anchor',
  kind: 'nightly-review',
  localDate: '2026-05-30',
  sourceId: 'nightly-review:user_1:agent_1:2026-05-30',
  triggerMessageId: 'msg_trigger',
};

const baseInput = {
  agentId: 'agent_1',
  artifacts: [] as ToolResultWithKind[],
  createdAt: 1_748_600_000_000,
  marker,
  mutations: [] as ToolResultWithKind[],
  operationId: 'op_1',
  sourceId: marker.sourceId!,
  sourceType: 'agent.execution.completed',
  topicId: 'tpc_1',
  userId: 'user_1',
};

describe('buildSelfIterationReceipts', () => {
  it('always emits one summary receipt with run counts', () => {
    const receipts = buildSelfIterationReceipts({
      ...baseInput,
      artifacts: [{ apiName: 'recordSelfReviewIdea', data: {}, kind: 'artifact' }],
    });

    expect(receipts).toHaveLength(1);
    const [summary] = receipts;
    expect(summary.id).toBe(`${marker.sourceId}:self-iteration-summary`);
    expect(summary.kind).toBe('review');
    expect(summary.status).toBe('completed');
    expect(summary.title).toBe('Nightly self-review completed');
    expect(summary.anchorMessageId).toBe('msg_anchor');
    expect(summary.triggerMessageId).toBe('msg_trigger');
    expect(summary.metadata?.actionCount).toBe(0);
  });

  it('projects a memory mutation into an applied memory receipt with a target', () => {
    const [, memory] = buildSelfIterationReceipts({
      ...baseInput,
      mutations: [
        {
          apiName: 'writeMemory',
          data: {
            kind: 'mutation',
            resourceId: 'mem_1',
            summary: 'Saved tone preference',
          },
          kind: 'mutation',
          toolCallId: 'call_1',
        },
      ],
    });

    expect(memory.kind).toBe('memory');
    expect(memory.status).toBe('applied');
    expect(memory.id).toBe(`${marker.sourceId}:call_1:memory`);
    expect(memory.title).toBe('Saved tone preference');
    expect(memory.metadata).toEqual({
      localDate: '2026-05-30',
      sourceType: 'agent.execution.completed',
    });
    expect(memory.target).toEqual({
      id: 'mem_1',
      summary: 'Saved tone preference',
      title: 'Saved tone preference',
      type: 'memory',
    });
  });

  it('preserves structured memory target metadata for layer-specific navigation', () => {
    const [, memory] = buildSelfIterationReceipts({
      ...baseInput,
      mutations: [
        {
          apiName: 'writeMemory',
          data: {
            kind: 'mutation',
            resourceId: 'pref_1',
            status: 'applied',
            summary: 'Use concise implementation notes.',
            target: {
              id: 'pref_1',
              memoryId: 'mem_1',
              memoryLayer: LayersEnum.Preference,
              title: 'Prefers concise implementation notes',
              type: 'memory',
            },
          },
          kind: 'mutation',
          toolCallId: 'call_pref',
        },
      ],
    });

    expect(memory.title).toBe('Prefers concise implementation notes');
    expect(memory.target).toEqual({
      id: 'pref_1',
      memoryId: 'mem_1',
      memoryLayer: LayersEnum.Preference,
      summary: 'Use concise implementation notes.',
      title: 'Prefers concise implementation notes',
      type: 'memory',
    });
  });

  it('maps proposal creation to a proposed review receipt without a target', () => {
    const [, proposal] = buildSelfIterationReceipts({
      ...baseInput,
      mutations: [
        {
          apiName: 'createSelfReviewProposal',
          data: { proposalId: 'brf_1', resourceId: 'brf_1', summary: 'Refine skill X' },
          kind: 'mutation',
          toolCallId: 'call_2',
        },
      ],
    });

    expect(proposal.kind).toBe('review');
    expect(proposal.status).toBe('proposed');
    expect(proposal.target).toBeUndefined();
  });

  it('collapses a skipped tool result to a skipped receipt', () => {
    const [, skill] = buildSelfIterationReceipts({
      ...baseInput,
      mutations: [
        {
          apiName: 'createSkillIfAbsent',
          data: { status: 'skipped_unsupported', summary: 'name taken' },
          kind: 'mutation',
          toolCallId: 'call_3',
        },
      ],
    });

    expect(skill.kind).toBe('skill');
    expect(skill.status).toBe('skipped');
    expect(skill.metadata?.rollbackStatus).toBeUndefined();
  });

  it('does not mark skill creation rollback available without a mutation id', () => {
    const [, skill] = buildSelfIterationReceipts({
      ...baseInput,
      mutations: [
        {
          apiName: 'createSkillIfAbsent',
          data: {
            resourceId: 'adoc_created',
            summary: 'Created support skill',
            target: {
              agentDocumentId: 'adoc_created',
              documentId: 'doc_created',
              id: 'adoc_created',
              title: 'Support skill',
              type: 'skill',
            },
          },
          kind: 'mutation',
          toolCallId: 'call_create_skill',
        },
      ],
    });

    expect(skill.kind).toBe('skill');
    expect(skill.status).toBe('applied');
    expect(skill.metadata).toEqual({
      localDate: '2026-05-30',
      sourceType: 'agent.execution.completed',
    });
  });

  it('does not mark skill creation rollback available when only resource metadata exists', () => {
    const [, skill] = buildSelfIterationReceipts({
      ...baseInput,
      mutations: [
        {
          apiName: 'createSkillIfAbsent',
          data: {
            resourceId: 'adoc_created',
            summary: 'Created support skill',
            target: {
              agentDocumentId: 'adoc_created',
              documentId: 'doc_created',
              id: 'adoc_created',
              title: 'Support skill',
              type: 'skill',
            },
          },
          kind: 'mutation',
          toolCallId: 'call_create_skill_with_mutation',
        },
      ],
    });

    expect(skill.kind).toBe('skill');
    expect(skill.metadata).toEqual({
      localDate: '2026-05-30',
      sourceType: 'agent.execution.completed',
    });
  });

  it('projects a skill rollback history ref and target document refs into an applied skill receipt', () => {
    const [, skill] = buildSelfIterationReceipts({
      ...baseInput,
      mutations: [
        {
          apiName: 'replaceSkillContentCAS',
          data: {
            agentDocumentId: 'adoc_1',
            documentId: 'doc_1',
            expectedCurrentDocumentUpdatedAt: '2026-06-29T00:00:00.000Z',
            historyId: 'history_1',
            resourceId: 'adoc_1',
            summary: 'Refined support skill',
            target: {
              agentDocumentId: 'adoc_1',
              documentId: 'doc_1',
              id: 'adoc_1',
              title: 'Support skill',
              type: 'skill',
            },
          },
          kind: 'mutation',
          toolCallId: 'call_skill',
        },
      ],
    });

    expect(skill.kind).toBe('skill');
    expect(skill.metadata).toEqual({
      agentDocumentId: 'adoc_1',
      documentId: 'doc_1',
      expectedCurrentDocumentUpdatedAt: '2026-06-29T00:00:00.000Z',
      historyId: 'history_1',
      localDate: '2026-05-30',
      rollbackStatus: 'available',
      sourceType: 'agent.execution.completed',
    });
    expect(skill.target).toEqual({
      agentDocumentId: 'adoc_1',
      documentId: 'doc_1',
      id: 'adoc_1',
      summary: 'Refined support skill',
      title: 'Support skill',
      type: 'skill',
    });
  });

  it('is idempotent: re-projecting the same run yields the same receipt ids', () => {
    const input = {
      ...baseInput,
      mutations: [
        {
          apiName: 'writeMemory',
          data: { resourceId: 'mem_1' },
          kind: 'mutation',
          toolCallId: 'c1',
        },
      ] as ToolResultWithKind[],
    };

    const first = buildSelfIterationReceipts(input).map((r) => r.id);
    const second = buildSelfIterationReceipts(input).map((r) => r.id);
    expect(first).toEqual(second);
  });
});

import { describe, expect, it } from 'vitest';

import {
  AgentInterventionRequestRevisionSchema,
  GetAgentInterventionReviewBySourceSchema,
  ResolveAgentInterventionBySourceSchema,
  ResolveAgentInterventionSchema,
} from './agentIntervention';

const revision = {
  hash: 'a'.repeat(64),
  version: 1,
};

const wrapper = {
  expectedBatchVersion: 1,
  expectedRequestRevisions: { 'item-1': revision },
  resolutionRequestId: '3db6ef38-701a-426f-832d-027369533b29',
  reviewToken: 'a'.repeat(43),
};

describe('ResolveAgentInterventionSchema', () => {
  it('accepts the frozen approve contract without client authority fields', () => {
    expect(
      ResolveAgentInterventionSchema.parse({
        ...wrapper,
        action: {
          itemIds: ['item-1'],
          scope: 'remember',
          type: 'approve_tool',
        },
      }),
    ).toMatchObject(wrapper);
  });

  it('strictly rejects the removed skip reason and any client operation/tool authority', () => {
    expect(
      ResolveAgentInterventionSchema.safeParse({
        ...wrapper,
        action: { itemId: 'item-1', reason: 'not in v2', type: 'skip_interaction' },
      }).success,
    ).toBe(false);
    expect(
      ResolveAgentInterventionSchema.safeParse({
        ...wrapper,
        action: { itemId: 'item-1', type: 'skip_interaction' },
        canonicalToolKey: 'lobe-local-system/editFile',
        operationId: 'client-operation',
      }).success,
    ).toBe(false);
  });

  it('accepts only operation-scoped Stop', () => {
    expect(
      ResolveAgentInterventionSchema.safeParse({
        ...wrapper,
        action: { scope: 'operation', type: 'stop' },
      }).success,
    ).toBe(true);
    expect(
      ResolveAgentInterventionSchema.safeParse({
        ...wrapper,
        action: { scope: 'batch', type: 'stop' },
      }).success,
    ).toBe(false);
  });

  it('requires a complete non-empty revision map and lowercase SHA-256 hashes', () => {
    expect(
      ResolveAgentInterventionSchema.safeParse({
        ...wrapper,
        action: { itemId: 'item-1', type: 'skip_interaction' },
        expectedRequestRevisions: {},
      }).success,
    ).toBe(false);
    expect(
      AgentInterventionRequestRevisionSchema.safeParse({ ...revision, hash: 'A'.repeat(64) })
        .success,
    ).toBe(false);
  });

  it('allows argument edits only for one selected intervention', () => {
    expect(
      ResolveAgentInterventionSchema.safeParse({
        ...wrapper,
        action: {
          edits: { 'item-1': { path: '/tmp/a' }, 'item-2': { path: '/tmp/b' } },
          itemIds: ['item-1', 'item-2'],
          scope: 'once',
          type: 'approve_tool',
        },
        expectedRequestRevisions: { 'item-1': revision, 'item-2': revision },
      }).success,
    ).toBe(false);
  });

  it('bounds private edited arguments by key count and serialized size', () => {
    const parse = (editedArguments: Record<string, unknown>) =>
      ResolveAgentInterventionSchema.safeParse({
        ...wrapper,
        action: {
          edits: { 'item-1': editedArguments },
          itemIds: ['item-1'],
          scope: 'once',
          type: 'approve_tool',
        },
      }).success;

    expect(
      parse(Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`k${index}`, 1]))),
    ).toBe(false);
    expect(parse({ content: 'x'.repeat(65 * 1024) })).toBe(false);
    expect(parse({ content: 'bounded' })).toBe(true);
  });

  it('keeps the marketplace external result discriminator exact', () => {
    expect(
      ResolveAgentInterventionSchema.safeParse({
        ...wrapper,
        action: {
          itemId: 'item-1',
          result: { kind: 'agent_marketplace', selectedIds: ['agent-1'] },
          type: 'submit_custom',
        },
      }).success,
    ).toBe(false);
    expect(
      ResolveAgentInterventionSchema.safeParse({
        ...wrapper,
        action: {
          itemId: 'item-1',
          result: { kind: 'agent_marketplace', selectedTemplateIds: ['agent-1'] },
          type: 'submit_custom',
        },
      }).success,
    ).toBe(true);
  });
});

describe('ResolveAgentInterventionBySourceSchema', () => {
  const source = {
    batchId: 'op-1:2:assistant-1',
    operationId: 'op-1',
    resolutionRequestId: '3db6ef38-701a-426f-832d-027369533b29',
    targets: [{ toolCallId: 'call-1', toolMessageId: 'message-1' }],
  };

  it('accepts exact source-locator Web actions without durable item authority', () => {
    expect(
      ResolveAgentInterventionBySourceSchema.parse({
        ...source,
        action: { scope: 'once', type: 'approve_tool' },
      }),
    ).toMatchObject(source);
    expect(
      ResolveAgentInterventionBySourceSchema.safeParse({
        ...source,
        action: {
          result: { kind: 'agent_marketplace', selectedTemplateIds: ['template-1'] },
          type: 'submit_custom',
        },
      }).success,
    ).toBe(true);
  });

  it('accepts only operation-scoped source Stop', () => {
    expect(
      ResolveAgentInterventionBySourceSchema.safeParse({
        ...source,
        action: { scope: 'operation', type: 'stop' },
      }).success,
    ).toBe(true);
    expect(
      ResolveAgentInterventionBySourceSchema.safeParse({
        ...source,
        action: { scope: 'batch', type: 'stop' },
      }).success,
    ).toBe(false);
  });

  it('applies the same edit bounds to source actions', () => {
    expect(
      ResolveAgentInterventionBySourceSchema.safeParse({
        ...source,
        action: {
          edits: { 'message-1': { content: 'x'.repeat(65 * 1024) } },
          scope: 'once',
          type: 'approve_tool',
        },
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate source targets and generic submit/skip payloads', () => {
    expect(
      ResolveAgentInterventionBySourceSchema.safeParse({
        ...source,
        action: { result: {}, type: 'submit' },
      }).success,
    ).toBe(false);
    expect(
      ResolveAgentInterventionBySourceSchema.safeParse({
        ...source,
        action: { reason: 'removed', type: 'skip_interaction' },
      }).success,
    ).toBe(false);
    expect(
      ResolveAgentInterventionBySourceSchema.safeParse({
        ...source,
        action: { scope: 'operation', type: 'stop' },
        targets: [source.targets[0], source.targets[0]],
      }).success,
    ).toBe(false);
  });

  it('reuses the exact strict locator contract for read-only source Review', () => {
    const locator = {
      batchId: source.batchId,
      operationId: source.operationId,
      targets: source.targets,
    };
    expect(GetAgentInterventionReviewBySourceSchema.parse(locator)).toEqual(locator);
    expect(
      GetAgentInterventionReviewBySourceSchema.safeParse({
        ...locator,
        action: { scope: 'once', type: 'approve_tool' },
      }).success,
    ).toBe(false);
    expect(
      GetAgentInterventionReviewBySourceSchema.safeParse({
        ...locator,
        targets: [source.targets[0], source.targets[0]],
      }).success,
    ).toBe(false);
  });
});

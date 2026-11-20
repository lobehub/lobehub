import { describe, expect, it } from 'vitest';

import type { AgentInterventionItem } from '../../../schemas';
import { AGENT_INTERVENTION_INVALID_ACTION } from '../constants';
import type { AgentInterventionContext } from '../context';
import type { ClaimAgentInterventionBatchParams } from '../types';
import { hasValidSealedSnapshot, hasValidSelection, validateAction } from '../validation';

const ctx = { userId: 'owner' } as AgentInterventionContext;

const row = (id: string, overrides: Partial<AgentInterventionItem> = {}) =>
  ({
    allowedActions: ['approve', 'reject_continue', 'stop'],
    canonicalToolKey: 'filesystem/writeFile',
    id,
    itemCount: 2,
    itemIndex: 0,
    requestRevisionHash: `hash-${id}`,
    sealed: true,
    status: 'pending',
    version: 1,
    ...overrides,
  }) as AgentInterventionItem;

const rows = [row('a'), row('b', { itemIndex: 1 })];

const params = (
  overrides: Partial<ClaimAgentInterventionBatchParams> = {},
): ClaimAgentInterventionBatchParams => ({
  action: { type: 'approve' },
  actorId: 'owner',
  batchId: 'batch',
  expectedItemCount: 2,
  expectedRequestRevisionHashes: { a: 'hash-a', b: 'hash-b' },
  expectedVersions: { a: 1, b: 1 },
  operationId: 'operation',
  resolutionRequestId: 'request',
  scope: 'single',
  selectedInterventionIds: ['a'],
  ...overrides,
});

describe('agentIntervention validation guards', () => {
  describe('hasValidSealedSnapshot', () => {
    it('accepts the exact sealed snapshot', () => {
      expect(hasValidSealedSnapshot(rows, params())).toBe(true);
    });

    it('rejects a snapshot whose item count no longer matches the batch', () => {
      expect(hasValidSealedSnapshot(rows, params({ expectedItemCount: 3 }))).toBe(false);
    });
  });

  describe('hasValidSelection', () => {
    it('rejects an empty selection', () => {
      expect(hasValidSelection(rows, [], params({ selectedInterventionIds: [] }), [])).toBe(false);
    });

    it('rejects a single-scope claim that selects more than one item', () => {
      expect(hasValidSelection(rows, rows, params(), ['a', 'b'])).toBe(false);
    });

    it('rejects an operation-wide stop while a sibling decision is still in flight', () => {
      const inFlight = [row('a'), row('b', { itemIndex: 1, status: 'resolving' })];

      expect(
        hasValidSelection(
          inFlight,
          [inFlight[0]],
          params({ action: { haltScope: 'operation', type: 'stop' }, scope: 'all' }),
          ['a'],
        ),
      ).toBe(false);
    });
  });

  describe('validateAction', () => {
    it('rejects an action that a target does not allow', () => {
      expect(() =>
        validateAction(ctx, [row('a')], params({ action: { type: 'skip_interaction' } })),
      ).toThrow(AGENT_INTERVENTION_INVALID_ACTION);
    });

    it('rejects edited arguments outside a single-item claim', () => {
      const target = row('a', { allowedActions: ['approve', 'edit_arguments'] });

      expect(() =>
        validateAction(
          ctx,
          [target],
          params({ action: { editedArguments: { path: '/tmp' }, type: 'approve' }, scope: 'all' }),
        ),
      ).toThrow(AGENT_INTERVENTION_INVALID_ACTION);
    });

    it('rejects approve-remember from an actor who is not the owner', () => {
      const target = row('a', { allowedActions: ['approve_remember'] });

      expect(() =>
        validateAction(
          ctx,
          [target],
          params({ action: { type: 'approve_remember' }, actorId: 'collaborator' }),
        ),
      ).toThrow(AGENT_INTERVENTION_INVALID_ACTION);
    });

    it('accepts approve-remember from the owner on a single remembered tool', () => {
      const target = row('a', { allowedActions: ['approve_remember'] });

      expect(() =>
        validateAction(ctx, [target], params({ action: { type: 'approve_remember' } })),
      ).not.toThrow();
    });
  });
});

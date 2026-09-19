import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { mapAgentInterventionTRPCError } from './agentInterventionError';

describe('mapAgentInterventionTRPCError', () => {
  it('maps a rejected response to a client error', () => {
    const cause = new Error('AGENT_INTERVENTION_INVALID_ACTION');
    const mapped = mapAgentInterventionTRPCError(cause);

    expect(mapped).toBeInstanceOf(TRPCError);
    expect(mapped).toMatchObject({ cause, code: 'BAD_REQUEST' });
  });

  it('maps a lost race to a conflict', () => {
    expect(
      mapAgentInterventionTRPCError(new Error('AGENT_INTERVENTION_RESOLUTION_CONFLICT')),
    ).toMatchObject({ code: 'CONFLICT' });
    expect(
      mapAgentInterventionTRPCError(new Error('AGENT_INTERVENTION_REVIEW_STALE')),
    ).toMatchObject({ code: 'CONFLICT' });
  });

  it('maps an unavailable review to a forbidden error', () => {
    expect(
      mapAgentInterventionTRPCError(new Error('AGENT_INTERVENTION_REVIEW_UNAVAILABLE')),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('keeps an existing tRPC error untouched', () => {
    const error = new TRPCError({ code: 'NOT_FOUND' });

    expect(mapAgentInterventionTRPCError(error)).toBe(error);
  });

  it('leaves an unrecognized failure alone so genuine faults stay 500', () => {
    const error = new Error('Connection terminated unexpectedly');

    expect(mapAgentInterventionTRPCError(error)).toBe(error);
  });
});

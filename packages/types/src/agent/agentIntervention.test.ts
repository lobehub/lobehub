import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  AgentInterventionCustomExecutionResult,
  AgentInterventionCustomExecutionState,
} from './agentIntervention';
import { AGENT_INTERVENTION_CUSTOM_EXECUTION_STATES } from './agentIntervention';

describe('agent intervention custom execution types', () => {
  it('keeps the execution state union aligned with its runtime literals', () => {
    expect(AGENT_INTERVENTION_CUSTOM_EXECUTION_STATES).toEqual([
      'pending',
      'executing',
      'completed',
    ]);
    expectTypeOf<
      (typeof AGENT_INTERVENTION_CUSTOM_EXECUTION_STATES)[number]
    >().toEqualTypeOf<AgentInterventionCustomExecutionState>();
  });

  it('keeps the durable private result intentionally narrow', () => {
    expectTypeOf<AgentInterventionCustomExecutionResult>().toEqualTypeOf<{
      content: string;
      pluginState: Record<string, unknown>;
    }>();
  });
});

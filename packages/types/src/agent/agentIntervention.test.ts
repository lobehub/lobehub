import { describe, expectTypeOf, it } from 'vitest';

import type {
  AGENT_INTERVENTION_CUSTOM_EXECUTION_STATES,
  AgentInterventionCustomExecutionResult,
  AgentInterventionCustomExecutionState,
} from './agentIntervention';

describe('agent intervention custom execution types', () => {
  it('keeps the execution state union aligned with its runtime literals', () => {
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

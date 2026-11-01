import { describe, expect, it } from 'vitest';

import {
  assertGoldenFinalState,
  extractGoldenOutcomes,
} from '../e2e/fixtures/agent-signal/assertGoldenFinalState';
import golden from '../e2e/fixtures/agent-signal/nightly-review.golden.json';

describe('agent-signal golden fixture - structural regression', () => {
  it('captures a recognizable nightly-review source payload', () => {
    expect(golden.source.sourceType).toBe('agent.nightly_review.requested');
    expect(golden.source.payload.agentId).toBeTruthy();
    expect(golden.source.payload.userId).toBeTruthy();
    expect(golden.source.scopeKey).toContain('agent:');
  });

  it('extracts ideas / write outcomes / brief from finalState', () => {
    const outcomes = extractGoldenOutcomes(golden.finalState);
    expect(outcomes.ideas.length).toBeGreaterThanOrEqual(1);
    expect(outcomes.writeOutcomes.length).toBeGreaterThanOrEqual(1);
    expect(outcomes.brief).toBeDefined();
  });

  it('passes the shared structural assertion', () => {
    expect(() => assertGoldenFinalState(golden.finalState)).not.toThrow();
  });

  it('rejects an empty finalState', () => {
    expect(() => assertGoldenFinalState({ messages: [] })).toThrow(/artifact/i);
  });
});

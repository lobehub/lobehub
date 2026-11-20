// @vitest-environment node
import {
  AGENT_SIGNAL_SCENARIOS,
  createScenarioPolicies,
  getAgentSignalScenario,
} from '../registry';

const mocks = vi.hoisted(() => ({
  analyzeIntent: vi.fn(() => ({ install: vi.fn(), name: 'analyze-intent' })),
  completion: vi.fn(() => ({ install: vi.fn(), name: 'completion' })),
  reviewNightly: vi.fn(() => []),
}));

// The real policy graph pulls the model runtime; the registry only wires factories together.
vi.mock('../../policies/analyzeIntent', () => ({ createAnalyzeIntentPolicy: mocks.analyzeIntent }));
vi.mock('../../policies/completionPolicy', () => ({ createCompletionPolicy: mocks.completion }));
vi.mock('../../policies/reviewNightly', () => ({ createReviewNightlyPolicy: mocks.reviewNightly }));

describe('agent signal scenario registry', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { execution: 'async', id: 'self-iteration' },
    { execution: 'sync', id: 'bot-wake' },
  ] as const)('registers $id as $execution', ({ execution, id }) => {
    expect(getAgentSignalScenario(id)).toBe(AGENT_SIGNAL_SCENARIOS[id]);
    expect(AGENT_SIGNAL_SCENARIOS[id].id).toBe(id);
    expect(AGENT_SIGNAL_SCENARIOS[id].execution).toBe(execution);
  });

  it('installs the legacy default stack, in order, for self-iteration', () => {
    const options = { nightlyReview: undefined };

    const policies = createScenarioPolicies('self-iteration', options);

    expect(policies).toHaveLength(2);
    expect(mocks.analyzeIntent).toHaveBeenCalledWith(options);
    expect(mocks.reviewNightly).toHaveBeenCalledTimes(1);
    expect(mocks.completion).toHaveBeenCalledWith({});
  });

  it('installs only the wake handler for bot-wake', () => {
    expect(createScenarioPolicies('bot-wake', {})).toHaveLength(1);
    expect(mocks.analyzeIntent).not.toHaveBeenCalled();
    expect(mocks.completion).not.toHaveBeenCalled();
  });
});

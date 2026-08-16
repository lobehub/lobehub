// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpertiseDomainService } from './domain';

const getAgentModelConfig = vi.fn();
const generateObject = vi.fn();
const createDomain = vi.fn();

vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getAgentModelConfig = getAgentModelConfig;
  },
}));
vi.mock('@/database/models/expertise', () => ({
  ExpertiseModel: class {
    createDomain = createDomain;
  },
}));
vi.mock('@/server/services/aiGeneration', () => ({
  AiGenerationService: class {
    generateObject = generateObject;
  },
}));

describe('ExpertiseDomainService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses structured generation instead of parsing the brief with string rules', async () => {
    getAgentModelConfig.mockResolvedValue({ model: 'test-model', provider: 'test-provider' });
    generateObject.mockResolvedValue({
      domainFilter: 'Include production incident diagnosis and remediation.',
      outOfScope: 'Exclude general architecture discussions without an incident.',
      title: 'Production incident response',
    });
    createDomain.mockResolvedValue('domain_1');

    const result = await new ExpertiseDomainService({} as never, 'user_1').createFromBrief({
      agentId: 'agent_1',
      brief: 'Help it improve at production incidents, excluding general design discussions.',
    });

    expect(generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: expect.objectContaining({ name: 'expertise_domain_brief' }),
      }),
      expect.any(Object),
    );
    expect(createDomain).toHaveBeenCalledWith({
      agentId: 'agent_1',
      brief: 'Help it improve at production incidents, excluding general design discussions.',
      domainFilter: 'Include production incident diagnosis and remediation.',
      outOfScope: 'Exclude general architecture discussions without an incident.',
      title: 'Production incident response',
    });
    expect(result).toBe('domain_1');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentEvalService } from '@/services/agentEval';

import { saveEnvironment } from './saveEnvironment';

vi.mock('@/services/agentEval', () => ({
  agentEvalService: { createEnvironment: vi.fn(), updateEnvironment: vi.fn() },
}));

const draft = { config: { timezone: 'UTC' }, description: ' description ', name: ' Environment ' };

beforeEach(() => vi.clearAllMocks());

describe('saving environment drafts', () => {
  it.each([undefined, { id: '' }])(
    'creates a new record for a new or duplicated draft: %j',
    async (row) => {
      await saveEnvironment({ ...draft, row });
      expect(agentEvalService.createEnvironment).toHaveBeenCalledWith({
        config: draft.config,
        description: 'description',
        identifier: expect.stringMatching(/^env-/),
        name: 'Environment',
      });
      expect(agentEvalService.updateEnvironment).not.toHaveBeenCalled();
    },
  );

  it('updates the existing id and allows its description to be cleared', async () => {
    await saveEnvironment({ ...draft, description: ' ', row: { id: 'existing-environment' } });
    expect(agentEvalService.updateEnvironment).toHaveBeenCalledWith({
      config: draft.config,
      description: null,
      id: 'existing-environment',
      name: 'Environment',
    });
    expect(agentEvalService.createEnvironment).not.toHaveBeenCalled();
  });

  it('propagates a failed save to the editor without a fallback mutation', async () => {
    const failure = new Error('Environment save rejected');
    vi.mocked(agentEvalService.createEnvironment).mockRejectedValueOnce(failure);
    await expect(saveEnvironment(draft)).rejects.toBe(failure);
    expect(agentEvalService.updateEnvironment).not.toHaveBeenCalled();
  });
});

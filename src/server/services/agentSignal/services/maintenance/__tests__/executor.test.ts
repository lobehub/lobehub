import { describe, expect, it, vi } from 'vitest';

import { createMaintenanceExecutorService } from '../executor';
import {
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  MaintenanceReviewScope,
  MaintenanceRisk,
} from '../types';

describe('maintenanceExecutorService', () => {
  /**
   * @example
   * The executor delegates auto-apply memory actions and records applied status.
   */
  it('executes auto-apply memory actions through the memory service', async () => {
    const writeMemory = vi.fn().mockResolvedValue({ memoryId: 'mem-1', summary: 'Saved.' });
    const executor = createMaintenanceExecutorService({
      memory: { writeMemory },
      skill: {},
    });

    const result = await executor.execute({
      actions: [
        {
          actionType: 'write_memory',
          applyMode: MaintenanceApplyMode.AutoApply,
          confidence: 0.95,
          dedupeKey: 'memory:concise',
          evidenceRefs: [{ id: 'msg-1', type: 'message' }],
          idempotencyKey: 'source:write_memory:memory:concise',
          operation: {
            domain: 'memory',
            input: { content: 'User prefers concise PR summaries.', userId: 'user-1' },
            operation: 'write',
          },
          rationale: 'Explicit preference.',
          risk: MaintenanceRisk.Low,
        },
      ],
      plannerVersion: 'test',
      reviewScope: MaintenanceReviewScope.Nightly,
      summary: 'One action.',
    });

    expect(result.actions).toEqual([
      {
        idempotencyKey: 'source:write_memory:memory:concise',
        resourceId: 'mem-1',
        status: MaintenanceActionStatus.Applied,
        summary: 'Saved.',
      },
    ]);
  });

  /**
   * @example
   * Proposal-only actions are recorded without calling domain services.
   */
  it('records proposal-only actions without mutation', async () => {
    const writeMemory = vi.fn();
    const executor = createMaintenanceExecutorService({
      memory: { writeMemory },
      skill: {},
    });

    const result = await executor.execute({
      actions: [
        {
          actionType: 'proposal_only',
          applyMode: MaintenanceApplyMode.ProposalOnly,
          confidence: 0.8,
          dedupeKey: 'proposal:skill-consolidation',
          evidenceRefs: [{ id: 'skill-a', type: 'agent_document' }],
          idempotencyKey: 'source:proposal_only:proposal:skill-consolidation',
          rationale: 'Needs user approval.',
          risk: MaintenanceRisk.High,
        },
      ],
      plannerVersion: 'test',
      reviewScope: MaintenanceReviewScope.Nightly,
      summary: 'One proposal.',
    });

    expect(writeMemory).not.toHaveBeenCalled();
    expect(result.actions[0].status).toBe(MaintenanceActionStatus.Proposed);
  });
});

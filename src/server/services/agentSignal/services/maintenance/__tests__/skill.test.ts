import { describe, expect, it, vi } from 'vitest';

import { createSkillManagementService } from '../skill';

describe('skillManagementService', () => {
  /**
   * @example
   * Writable managed skill documents may be refined automatically.
   */
  it('refines writable managed skills through the injected adapter', async () => {
    const refineSkill = vi
      .fn()
      .mockResolvedValue({ skillDocumentId: 'doc-1', summary: 'Refined skill.' });
    const service = createSkillManagementService({ refineSkill });

    await expect(
      service.refineSkill({
        evidenceRefs: [{ id: 'msg-1', type: 'message' }],
        idempotencyKey: 'source:refine_skill:skill:doc-1',
        input: {
          patch: 'Add checklist step for failed release note validation.',
          skillDocumentId: 'doc-1',
          userId: 'user-1',
        },
      }),
    ).resolves.toEqual({ skillDocumentId: 'doc-1', summary: 'Refined skill.' });

    expect(refineSkill).toHaveBeenCalledOnce();
  });

  /**
   * @example
   * Readonly builtin or marketplace skills are not mutated by this service.
   */
  it('rejects readonly skill targets before persistence', async () => {
    const refineSkill = vi.fn();
    const service = createSkillManagementService({ refineSkill });

    await expect(
      service.refineSkill({
        evidenceRefs: [{ id: 'builtin-skill', type: 'agent_document' }],
        idempotencyKey: 'source:refine_skill:skill:builtin',
        input: {
          patch: 'Change builtin skill.',
          skillDocumentId: 'builtin-skill',
          targetReadonly: true,
          userId: 'user-1',
        },
      }),
    ).rejects.toThrow('Skill target is readonly');

    expect(refineSkill).not.toHaveBeenCalled();
  });
});

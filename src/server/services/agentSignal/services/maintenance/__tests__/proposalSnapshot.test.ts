import { describe, expect, it, vi } from 'vitest';

import { createMaintenanceProposalSnapshotService } from '../proposalSnapshot';

describe('maintenance proposal snapshot service', () => {
  /**
   * @example
   * expect(snapshot).toEqual({ targetType: 'skill', contentHash: 'sha256:base' });
   */
  it('captures complete refine_skill base snapshots', async () => {
    const readSkillTargetSnapshot = vi.fn(async () => ({
      agentDocumentId: 'agent-doc-1',
      contentHash: 'sha256:base',
      documentId: 'doc-1',
      documentUpdatedAt: '2026-05-09T00:00:00.000Z',
      managed: true,
      targetTitle: 'Code Review',
      writable: true,
    }));
    const service = createMaintenanceProposalSnapshotService({
      isSkillNameAvailable: async () => true,
      readSkillTargetSnapshot,
    });

    await expect(
      service.captureActionSnapshot({
        actionType: 'refine_skill',
        agentId: 'agent-1',
        input: { skillDocumentId: 'agent-doc-1' },
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      agentDocumentId: 'agent-doc-1',
      contentHash: 'sha256:base',
      documentId: 'doc-1',
      documentUpdatedAt: '2026-05-09T00:00:00.000Z',
      managed: true,
      targetTitle: 'Code Review',
      targetType: 'skill',
      writable: true,
    });
    expect(readSkillTargetSnapshot).toHaveBeenCalledWith('agent-doc-1');
  });

  /**
   * @example
   * expect(snapshot).toMatchObject({ absent: true, skillName: 'code-review' });
   */
  it('captures absent-target snapshots for create_skill', async () => {
    const isSkillNameAvailable = vi.fn(async () => true);
    const service = createMaintenanceProposalSnapshotService({
      isSkillNameAvailable,
      readSkillTargetSnapshot: async () => undefined,
    });

    await expect(
      service.captureActionSnapshot({
        actionType: 'create_skill',
        agentId: 'agent-1',
        input: { name: 'code-review', title: 'Code Review' },
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      absent: true,
      skillName: 'code-review',
      targetTitle: 'Code Review',
      targetType: 'skill',
    });
    expect(isSkillNameAvailable).toHaveBeenCalledWith({
      agentId: 'agent-1',
      name: 'code-review',
      userId: 'user-1',
    });
  });

  /**
   * @example
   * expect(capture).rejects.toThrow('Skill name is already taken');
   */
  it('rejects create_skill snapshots when the stable skill name is already taken', async () => {
    const service = createMaintenanceProposalSnapshotService({
      isSkillNameAvailable: async () => false,
      readSkillTargetSnapshot: async () => undefined,
    });

    await expect(
      service.captureActionSnapshot({
        actionType: 'create_skill',
        agentId: 'agent-1',
        input: { name: 'code-review' },
        userId: 'user-1',
      }),
    ).rejects.toThrow('Skill name is already taken');
  });
});

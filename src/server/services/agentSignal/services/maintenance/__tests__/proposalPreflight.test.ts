import { describe, expect, it } from 'vitest';

import { createMaintenanceProposalPreflightService } from '../proposalPreflight';
import { MaintenanceRisk } from '../types';

const createRefineAction = (contentHash = 'sha256:base') => ({
  actionType: 'refine_skill' as const,
  baseSnapshot: {
    agentDocumentId: 'adoc_1',
    contentHash,
    documentId: 'doc_1',
    managed: true,
    targetTitle: 'Skill Index',
    writable: true,
  },
  evidenceRefs: [],
  idempotencyKey: 'key',
  operation: {
    domain: 'skill' as const,
    input: { patch: 'new body', skillDocumentId: 'adoc_1', userId: 'user_1' },
    operation: 'refine' as const,
  },
  rationale: 'Update skill',
  risk: MaintenanceRisk.Medium,
  target: { skillDocumentId: 'adoc_1' },
});

describe('maintenance proposal preflight', () => {
  /**
   * @example
   * expect(result.allowed).toBe(true);
   */
  it('allows unchanged skill document targets', async () => {
    const service = createMaintenanceProposalPreflightService({
      readSkillTarget: async () => ({
        agentDocumentId: 'adoc_1',
        contentHash: 'sha256:base',
        documentId: 'doc_1',
        managed: true,
        targetTitle: 'Skill Index',
        writable: true,
      }),
    });

    await expect(service.checkAction(createRefineAction())).resolves.toEqual({ allowed: true });
  });

  /**
   * @example
   * expect(result.reason).toBe('document_changed');
   */
  it('marks changed content as stale', async () => {
    const service = createMaintenanceProposalPreflightService({
      readSkillTarget: async () => ({
        agentDocumentId: 'adoc_1',
        contentHash: 'sha256:current',
        documentId: 'doc_1',
        managed: true,
        targetTitle: 'Skill Index',
        writable: true,
      }),
    });

    await expect(service.checkAction(createRefineAction())).resolves.toEqual({
      allowed: false,
      reason: 'document_changed',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('target_not_writable');
   */
  it('rejects unmanaged or readonly targets', async () => {
    const service = createMaintenanceProposalPreflightService({
      readSkillTarget: async () => ({
        agentDocumentId: 'adoc_1',
        contentHash: 'sha256:base',
        documentId: 'doc_1',
        managed: false,
        writable: true,
      }),
    });

    await expect(service.checkAction(createRefineAction())).resolves.toEqual({
      allowed: false,
      reason: 'target_not_writable',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('target_deleted');
   */
  it('rejects missing targets', async () => {
    const service = createMaintenanceProposalPreflightService({
      readSkillTarget: async () => undefined,
    });

    await expect(service.checkAction(createRefineAction())).resolves.toEqual({
      allowed: false,
      reason: 'target_deleted',
    });
  });
});

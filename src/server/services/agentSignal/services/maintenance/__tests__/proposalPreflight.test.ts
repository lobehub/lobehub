import { describe, expect, it, vi } from 'vitest';

import type { MaintenanceProposalPreflightAdapters } from '../proposalPreflight';
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
    targetType: 'skill' as const,
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

const createCreateAction = () => ({
  actionType: 'create_skill' as const,
  baseSnapshot: {
    absent: true,
    skillName: 'code-review',
    targetTitle: 'Code Review',
    targetType: 'skill' as const,
  },
  evidenceRefs: [],
  idempotencyKey: 'key-create',
  operation: {
    domain: 'skill' as const,
    input: {
      bodyMarkdown: 'Review preferences',
      name: 'code-review',
      title: 'Code Review',
      userId: 'user_1',
    },
    operation: 'create' as const,
  },
  rationale: 'Create skill',
  risk: MaintenanceRisk.Medium,
  target: { skillName: 'code-review' },
});

const createAdapters = (
  overrides: Partial<MaintenanceProposalPreflightAdapters> = {},
): MaintenanceProposalPreflightAdapters => ({
  isSkillNameAvailable: async () => true,
  readSkillTargetSnapshot: async () => ({
    agentDocumentId: 'adoc_1',
    contentHash: 'sha256:base',
    documentId: 'doc_1',
    managed: true,
    targetTitle: 'Skill Index',
    writable: true,
  }),
  ...overrides,
});

describe('maintenance proposal preflight', () => {
  /**
   * @example
   * expect(result.allowed).toBe(true);
   */
  it('allows fresh refine_skill proposals with matching snapshot', async () => {
    const readSkillTargetSnapshot = vi.fn(createAdapters().readSkillTargetSnapshot);
    const service = createMaintenanceProposalPreflightService(
      createAdapters({ readSkillTargetSnapshot }),
    );

    await expect(service.checkAction(createRefineAction())).resolves.toEqual({ allowed: true });
    expect(readSkillTargetSnapshot).toHaveBeenCalledWith('adoc_1');
  });

  /**
   * @example
   * expect(result.reason).toBe('content_changed');
   */
  it('rejects drifted refine_skill when content hash changed', async () => {
    const service = createMaintenanceProposalPreflightService({
      ...createAdapters(),
      readSkillTargetSnapshot: async () => ({
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
      reason: 'content_changed',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('target_type_changed');
   */
  it('rejects refine_skill when frozen target identity drifts from the base snapshot', async () => {
    const service = createMaintenanceProposalPreflightService(createAdapters());
    const action = createRefineAction();

    await expect(
      service.checkAction({
        ...action,
        target: { skillDocumentId: 'adoc_2' },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'target_type_changed',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('target_type_changed');
   */
  it('rejects refine_skill when frozen operation identity drifts from the base snapshot', async () => {
    const service = createMaintenanceProposalPreflightService(createAdapters());
    const action = createRefineAction();

    await expect(
      service.checkAction({
        ...action,
        operation: {
          ...action.operation,
          input: { ...action.operation.input, skillDocumentId: 'adoc_2' },
        },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'target_type_changed',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('target_unmanaged');
   */
  it('rejects unmanaged targets', async () => {
    const service = createMaintenanceProposalPreflightService({
      ...createAdapters(),
      readSkillTargetSnapshot: async () => ({
        agentDocumentId: 'adoc_1',
        contentHash: 'sha256:base',
        documentId: 'doc_1',
        managed: false,
        writable: true,
      }),
    });

    await expect(service.checkAction(createRefineAction())).resolves.toEqual({
      allowed: false,
      reason: 'target_unmanaged',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('target_not_writable');
   */
  it('rejects readonly targets', async () => {
    const service = createMaintenanceProposalPreflightService({
      ...createAdapters(),
      readSkillTargetSnapshot: async () => ({
        agentDocumentId: 'adoc_1',
        contentHash: 'sha256:base',
        documentId: 'doc_1',
        managed: true,
        writable: false,
      }),
    });

    await expect(service.checkAction(createRefineAction())).resolves.toEqual({
      allowed: false,
      reason: 'target_not_writable',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('snapshot_missing');
   */
  it('does not report missing base snapshots as target_deleted', async () => {
    const service = createMaintenanceProposalPreflightService(createAdapters());
    const action = createRefineAction();
    const { baseSnapshot: _baseSnapshot, ...actionWithoutSnapshot } = action;

    await expect(service.checkAction(actionWithoutSnapshot)).resolves.toEqual({
      allowed: false,
      reason: 'snapshot_missing',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('snapshot_incomplete');
   */
  it('rejects incomplete refine_skill base snapshots', async () => {
    const service = createMaintenanceProposalPreflightService(createAdapters());
    const action = createRefineAction();
    const { contentHash: _contentHash, ...incompleteSnapshot } = action.baseSnapshot;

    await expect(
      service.checkAction({
        ...action,
        baseSnapshot: incompleteSnapshot,
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'snapshot_incomplete',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('target_deleted');
   */
  it('rejects missing targets', async () => {
    const service = createMaintenanceProposalPreflightService({
      ...createAdapters(),
      readSkillTargetSnapshot: async () => undefined,
    });

    await expect(service.checkAction(createRefineAction())).resolves.toEqual({
      allowed: false,
      reason: 'target_deleted',
    });
  });

  /**
   * @example
   * expect(result.allowed).toBe(true);
   */
  it('allows create_skill proposals when stable name is still absent', async () => {
    const isSkillNameAvailable = vi.fn(async () => true);
    const service = createMaintenanceProposalPreflightService(
      createAdapters({ isSkillNameAvailable }),
    );

    await expect(service.checkAction(createCreateAction())).resolves.toEqual({ allowed: true });
    expect(isSkillNameAvailable).toHaveBeenCalledWith({
      name: 'code-review',
      userId: 'user_1',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('target_conflict');
   */
  it('rejects create_skill proposals when stable name is now taken', async () => {
    const service = createMaintenanceProposalPreflightService(
      createAdapters({ isSkillNameAvailable: async () => false }),
    );

    await expect(service.checkAction(createCreateAction())).resolves.toEqual({
      allowed: false,
      reason: 'target_conflict',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('target_type_changed');
   */
  it('rejects create_skill when frozen target name drifts from the base snapshot', async () => {
    const service = createMaintenanceProposalPreflightService(createAdapters());
    const action = createCreateAction();

    await expect(
      service.checkAction({
        ...action,
        target: { skillName: 'incident-review' },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'target_type_changed',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('target_type_changed');
   */
  it('rejects create_skill when frozen operation name drifts from the base snapshot', async () => {
    const service = createMaintenanceProposalPreflightService(createAdapters());
    const action = createCreateAction();

    await expect(
      service.checkAction({
        ...action,
        operation: {
          ...action.operation,
          input: { ...action.operation.input, name: 'incident-review' },
        },
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'target_type_changed',
    });
  });

  /**
   * @example
   * expect(result.reason).toBe('unsupported');
   */
  it('keeps unsupported actions unsupported', async () => {
    const service = createMaintenanceProposalPreflightService(createAdapters());
    const action = createRefineAction();

    await expect(
      service.checkAction({ ...action, actionType: 'consolidate_skill' }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'unsupported',
    });
  });
});

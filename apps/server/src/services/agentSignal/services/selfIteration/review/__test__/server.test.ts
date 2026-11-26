// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';
import type { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { createReviewRuntimePrimitives, createServerSelfReviewPolicyOptions } from '../server';

const baseGuardInput = {
  agentId: 'agent-1',
  guardKey: 'nightly-review:user-1:agent-1:2026-05-04',
  localDate: '2026-05-04',
  requestedAt: '2026-05-04T14:00:00.000Z',
  reviewWindowEnd: '2026-05-04T14:00:00.000Z',
  reviewWindowStart: '2026-05-03T14:00:00.000Z',
  sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
  timezone: 'Asia/Shanghai',
  userId: 'user-1',
} as const;

describe('createServerSelfReviewPolicyOptions', () => {
  it('exposes dispatch-shaped handler deps (gate, guard, collector, db) without legacy runner/brief/receipt wiring', () => {
    const options = createServerSelfReviewPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });

    expect(options.acquireReviewGuard).toEqual(expect.any(Function));
    expect(options.canRunReview).toEqual(expect.any(Function));
    expect(options.collectContext).toEqual(expect.any(Function));
    expect(options.db).toBeDefined();
    // The nightly run + brief + receipts now happen via execAgent / the builtin
    // review serverRuntime / the completion path — not inline here.
    expect('runSelfReviewAgent' in options).toBe(false);
    expect('writeDailyBrief' in options).toBe(false);
    expect('writeReceipts' in options).toBe(false);
    expect('resolveBriefTextTranslator' in options).toBe(false);
  });

  it('rejects the review when self-iteration is disabled (before any DB access)', async () => {
    const options = createServerSelfReviewPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: false,
      userId: 'user-1',
    });

    await expect(options.canRunReview(baseGuardInput)).resolves.toBe(false);
  });

  it('rejects reviews whose payload user id does not match the policy owner', async () => {
    const options = createServerSelfReviewPolicyOptions({
      agentId: 'agent-1',
      db: {} as unknown as LobeChatDatabase,
      selfIterationEnabled: true,
      userId: 'user-1',
    });

    await expect(options.canRunReview({ ...baseGuardInput, userId: 'user-2' })).resolves.toBe(
      false,
    );
  });
});

describe('createReviewRuntimePrimitives', () => {
  it('builds the live review tool surface (skill/memory writes + proposal lifecycle) for the serverRuntime', () => {
    const service = createReviewRuntimePrimitives({
      agentId: 'agent-1',
      briefModel: {} as never,
      db: {} as unknown as LobeChatDatabase,
      localDate: '2026-05-04',
      proposalBriefWriter: {} as never,
      reviewWindowEnd: '2026-05-04T14:00:00.000Z',
      reviewWindowStart: '2026-05-03T14:00:00.000Z',
      skillDocumentService: {} as never,
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      userId: 'user-1',
    });

    // Pure construction (no DB / receipt / operation side channel) — just the
    // advertised api surface the package runtime echoes.
    expect(service.createSelfReviewProposal).toEqual(expect.any(Function));
    expect(service.createSkillIfAbsent).toEqual(expect.any(Function));
    expect(service.replaceSkillContentCAS).toEqual(expect.any(Function));
    expect(service.writeMemory).toEqual(expect.any(Function));
    expect(service.listManagedSkills).toEqual(expect.any(Function));
    expect(service.listSelfReviewProposals).toEqual(expect.any(Function));
  });

  /**
   * @example
   * A nightly review refines a managed skill and exposes every receipt rollback reference.
   */
  it('returns skill rollback refs from the nightly review runtime', async () => {
    const currentSnapshot = {
      agentDocumentId: 'adoc-1',
      contentHash: 'sha256:before',
      documentId: 'doc-bundle-1',
      managed: true,
      targetType: 'skill' as const,
      writable: true,
    };
    const service = createReviewRuntimePrimitives({
      agentId: 'agent-1',
      briefModel: {} as never,
      db: {} as unknown as LobeChatDatabase,
      localDate: '2026-05-04',
      proposalBriefWriter: {} as never,
      reviewWindowEnd: '2026-05-04T14:00:00.000Z',
      reviewWindowStart: '2026-05-03T14:00:00.000Z',
      skillDocumentService: {
        listSkills: vi.fn().mockResolvedValue([]),
        readSkillTargetSnapshot: vi.fn().mockResolvedValue(currentSnapshot),
        replaceSkillIndex: vi.fn().mockResolvedValue({
          bundle: {
            agentDocumentId: 'adoc-1',
            documentId: 'doc-bundle-1',
          },
          expectedCurrentDocumentUpdatedAt: '2026-06-29T00:00:00.000Z',
          index: {
            agentDocumentId: 'adoc-index-1',
            documentId: 'doc-index-1',
          },
          name: 'support-skill',
          preMutationHistoryId: 'history-1',
          title: 'Support Skill',
        }),
      } as unknown as SkillManagementDocumentService,
      sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
      userId: 'user-1',
    });

    const result = await service.replaceSkillContentCAS?.(
      {
        baseSnapshot: currentSnapshot,
        bodyMarkdown: 'Updated skill body.',
        idempotencyKey: 'skill-replace-1',
        skillDocumentId: 'adoc-1',
        userId: 'user-1',
      },
      {},
    );

    expect(result).toMatchObject({
      agentDocumentId: 'adoc-1',
      documentId: 'doc-index-1',
      expectedCurrentDocumentUpdatedAt: '2026-06-29T00:00:00.000Z',
      historyId: 'history-1',
      resourceId: 'adoc-1',
      target: {
        agentDocumentId: 'adoc-1',
        documentId: 'doc-bundle-1',
        id: 'adoc-1',
        title: 'Support Skill',
        type: 'skill',
      },
    });
  });

  /**
   * @example
   * Production nightly reviews send the action kind as `type`; the proposal must
   * still project to a Daily Brief instead of failing with "no brief".
   */
  it('creates a proposal brief when the model names the action kind `type`', async () => {
    const writeDailyBrief = vi.fn().mockResolvedValue({ id: 'brief-1' });
    const service = createReviewRuntimePrimitives({
      agentId: 'agent-1',
      briefModel: {} as never,
      db: {} as unknown as LobeChatDatabase,
      localDate: '2026-10-10',
      proposalBriefWriter: { writeDailyBrief } as never,
      reviewWindowEnd: '2026-10-10T14:00:00.000Z',
      reviewWindowStart: '2026-10-09T14:00:00.000Z',
      skillDocumentService: {
        listSkills: vi.fn().mockResolvedValue([]),
      } as unknown as SkillManagementDocumentService,
      sourceId: 'nightly-review:user-1:agent-1:2026-10-10',
      userId: 'user-1',
    });

    const result = await service.createSelfReviewProposal?.(
      {
        actions: [
          {
            operation: {
              domain: 'skill',
              input: {
                bodyMarkdown: '# Release notes\n\nSteps...',
                description: 'Draft release notes from merged PRs.',
                name: 'release-notes',
                title: 'Release notes',
              },
              operation: 'create',
            },
            rationale: 'Repeated release-note workflow across topics.',
            target: { skillName: 'release-notes' },
            type: 'create_skill',
          },
        ],
        idempotencyKey: 'proposal-1',
        proposalKey: 'skill:release-notes',
        summary: 'Create a release-notes skill.',
        userId: 'user-1',
      },
      {},
    );

    expect(result).toMatchObject({ proposalId: 'brief-1' });
    expect(writeDailyBrief).toHaveBeenCalledTimes(1);
  });

  it('rejects proposal actions without a recognizable actionType with a recoverable error', async () => {
    const service = createReviewRuntimePrimitives({
      agentId: 'agent-1',
      briefModel: {} as never,
      db: {} as unknown as LobeChatDatabase,
      localDate: '2026-10-10',
      proposalBriefWriter: { writeDailyBrief: vi.fn() } as never,
      reviewWindowEnd: '2026-10-10T14:00:00.000Z',
      reviewWindowStart: '2026-10-09T14:00:00.000Z',
      skillDocumentService: { listSkills: vi.fn().mockResolvedValue([]) } as never,
      sourceId: 'nightly-review:user-1:agent-1:2026-10-10',
      userId: 'user-1',
    });

    await expect(
      service.createSelfReviewProposal?.(
        {
          actions: [{ target: { skillName: 'x' } }],
          idempotencyKey: 'proposal-2',
          proposalKey: 'skill:x',
          summary: 'Missing kind.',
          userId: 'user-1',
        },
        {},
      ),
    ).rejects.toThrow('actions[0] has no actionType');
  });

  describe('createSelfReviewProposal action counts', () => {
    const createProposalService = () => {
      const writeDailyBrief = vi.fn().mockResolvedValue({ id: 'brief-1' });
      const service = createReviewRuntimePrimitives({
        agentId: 'agent-1',
        briefModel: {} as never,
        db: {} as unknown as LobeChatDatabase,
        localDate: '2026-11-17',
        proposalBriefWriter: { writeDailyBrief } as never,
        reviewWindowEnd: '2026-11-17T14:00:00.000Z',
        reviewWindowStart: '2026-11-16T14:00:00.000Z',
        skillDocumentService: {
          listSkills: vi.fn().mockResolvedValue([]),
          readSkillTargetSnapshot: vi.fn().mockResolvedValue({
            agentDocumentId: 'agd-testing',
            contentHash: 'hash-1',
            documentId: 'doc-testing',
            managed: true,
            targetType: 'skill',
            writable: true,
          }),
        } as unknown as SkillManagementDocumentService,
        sourceId: 'nightly-review:user-1:agent-1:2026-11-17',
        userId: 'user-1',
      });

      return { service, writeDailyBrief };
    };

    const createSkillAction = (name: string) => ({
      actionType: 'create_skill',
      operation: {
        domain: 'skill',
        input: { bodyMarkdown: `# ${name}\n\nSteps...`, description: name, name, title: name },
        operation: 'create',
      },
      rationale: `Repeated ${name} workflow across topics.`,
      target: { skillName: name },
    });

    const refineSkillAction = {
      actionType: 'refine_skill',
      operation: {
        domain: 'skill',
        input: { bodyMarkdown: '# Testing\n\nRun one file.', skillDocumentId: 'agd-testing' },
        operation: 'refine',
      },
      rationale: 'The user corrected the full-suite command twice.',
      target: { skillDocumentId: 'agd-testing' },
    };

    const getStoredProposalActions = (writeDailyBrief: ReturnType<typeof vi.fn>) =>
      writeDailyBrief.mock.calls[0][0].metadata.agentSignal.nightlySelfReview.selfReviewProposal
        .actions;

    it.each([
      { actions: [refineSkillAction], label: '1 refine_skill' },
      { actions: [createSkillAction('release-notes')], label: '1 create_skill' },
      {
        actions: [createSkillAction('release-notes'), refineSkillAction],
        label: '2',
      },
      {
        actions: [createSkillAction('a-skill'), createSkillAction('b-skill'), refineSkillAction],
        label: '3',
      },
    ])('stores a proposal with $label action(s) on the first call', async ({ actions }) => {
      const { service, writeDailyBrief } = createProposalService();

      const result = await service.createSelfReviewProposal?.(
        {
          actions,
          idempotencyKey: 'proposal-n',
          proposalKey: 'skill:proposal-n',
          summary: 'Proposal with several actions.',
          userId: 'user-1',
        },
        {},
      );

      expect(result).toMatchObject({ proposalId: 'brief-1' });
      expect(writeDailyBrief).toHaveBeenCalledTimes(1);
      expect(
        getStoredProposalActions(writeDailyBrief).map(
          (action: { actionType: string }) => action.actionType,
        ),
      ).toEqual(actions.map((action) => action.actionType));
    });

    it('stores a single action sent as an object instead of an array', async () => {
      const { service, writeDailyBrief } = createProposalService();

      await expect(
        service.createSelfReviewProposal?.(
          {
            actions: refineSkillAction as unknown as unknown[],
            idempotencyKey: 'proposal-object',
            proposalKey: 'skill:testing',
            summary: 'Refine the testing skill.',
            userId: 'user-1',
          },
          {},
        ),
      ).resolves.toMatchObject({ proposalId: 'brief-1' });
      expect(getStoredProposalActions(writeDailyBrief)).toHaveLength(1);
    });

    /**
     * @example
     * The vent shape: one action object, then the rest of the call spilled into
     * the array as bare strings. The error must name that stray string instead
     * of a bare "actions[1] has no actionType", and nothing is written.
     */
    it('rejects a spilled single action with the stray value and missing fields', async () => {
      const { service, writeDailyBrief } = createProposalService();

      const call = service.createSelfReviewProposal?.(
        {
          actions: [refineSkillAction, 'rationale?', 'summary?', 'idempotencyKey?'],
          userId: 'user-1',
        } as never,
        {},
      );

      await expect(call).rejects.toThrow(
        'actions[1] is the string "rationale?", not an action object',
      );
      await expect(call).rejects.toThrow(
        'Top-level fields idempotencyKey, proposalKey, summary are missing',
      );
      expect(writeDailyBrief).not.toHaveBeenCalled();
    });
  });
});

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
});

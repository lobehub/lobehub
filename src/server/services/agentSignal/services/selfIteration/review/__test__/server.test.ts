// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { LobeChatDatabase } from '@/database/type';

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

    await expect(options.canRunReview({ ...baseGuardInput, userId: 'user-2' })).resolves.toBe(false);
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
});

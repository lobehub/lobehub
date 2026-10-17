// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';

import { ActionStatus, ApplyMode, ReviewRunStatus, Risk, Scope } from '../../types';
import { createBriefSelfReviewService, createServerSelfReviewBriefWriter } from '../brief';
import type { SelfReviewBriefTextTranslator } from '../briefText';

afterEach(() => {
  vi.restoreAllMocks();
});

const completeRefineSkillBaseSnapshot = (agentDocumentId: string) => ({
  agentDocumentId,
  contentHash: `sha256:${agentDocumentId}`,
  documentId: `doc-${agentDocumentId}`,
  managed: true,
  targetType: 'skill' as const,
  writable: true,
});

const getNightlySelfReview = (
  brief: ReturnType<ReturnType<typeof createBriefSelfReviewService>['projectNightlyReviewBrief']>,
) => brief?.metadata.agentSignal.nightlySelfReview;

const getSelfReviewProposal = (
  brief: ReturnType<ReturnType<typeof createBriefSelfReviewService>['projectNightlyReviewBrief']>,
) => getNightlySelfReview(brief)?.selfReviewProposal;

const zhCNBriefText: Record<string, string> = {
  'brief.agentSignal.selfReview.applied.heading': '已更新',
  'brief.agentSignal.selfReview.applied.summary': '已应用 {{count}} 条夜间回顾更新。',
  'brief.agentSignal.selfReview.applied.summary_plural': '已应用 {{count}} 条夜间回顾更新。',
  'brief.agentSignal.selfReview.applied.title': '夜间回顾已更新资源',
  'brief.agentSignal.selfReview.ideas.summary': '已保存夜间回顾记录，供后续查看。',
  'brief.agentSignal.selfReview.ideas.title': '夜间回顾记录',
  'brief.agentSignal.selfReview.proposal.heading': '建议',
  'brief.agentSignal.selfReview.proposal.summary': '有 {{count}} 条夜间回顾建议需要你确认。',
  'brief.agentSignal.selfReview.proposal.summary_plural': '有 {{count}} 条夜间回顾建议需要你确认。',
  'brief.agentSignal.selfReview.proposal.title': '有夜间回顾建议需要确认',
};

const createTranslator =
  (resources: Record<string, string>): SelfReviewBriefTextTranslator =>
  (key, options = {}) =>
    Object.entries(options).reduce(
      (content, [name, value]) => content.replace(`{{${name}}}`, value),
      resources[key] ?? key,
    );

describe('briefSelfReviewService', () => {
  /**
   * @example
   * Applied nightly actions produce an insight brief with stable trigger metadata.
   */
  it('projects applied nightly results to insight briefs', () => {
    const service = createBriefSelfReviewService();

    const brief = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-04',
      result: {
        actions: [
          {
            idempotencyKey: 'source:write_memory:memory:concise',
            receiptId: 'receipt-1',
            resourceId: 'mem-1',
            status: ActionStatus.Applied,
            summary: 'Saved concise PR summary preference.',
          },
        ],
        sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-04T14:30:00.000Z',
      reviewWindowStart: '2026-05-03T16:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(brief).toMatchObject({
      agentId: 'agent-1',
      trigger: 'agent-signal:nightly-review',
      type: 'insight',
    });
    expect(brief?.metadata).toMatchObject({
      agentSignal: {
        nightlySelfReview: {
          actionCounts: { applied: 1, failed: 0, proposed: 0, skipped: 0 },
          localDate: '2026-05-04',
          outcome: 'applied',
          receiptIds: ['receipt-1'],
          sourceId: 'nightly-review:user-1:agent-1:2026-05-04',
          timezone: 'Asia/Shanghai',
        },
      },
    });
    expect(brief?.metadata).not.toHaveProperty('actionCounts');
    expect(brief?.metadata).not.toHaveProperty('outcome');
  });

  /**
   * @example
   * Pure noop results do not create Daily Briefs.
   */
  it('does not create briefs for pure noop outcomes', () => {
    const service = createBriefSelfReviewService();

    expect(
      service.projectNightlyReviewBrief({
        agentId: 'agent-1',
        localDate: '2026-05-04',
        result: { actions: [], status: ReviewRunStatus.Completed },
        reviewWindowEnd: '2026-05-04T14:30:00.000Z',
        reviewWindowStart: '2026-05-03T16:00:00.000Z',
        timezone: 'Asia/Shanghai',
        userId: 'user-1',
      }),
    ).toBeUndefined();
  });

  /**
   * @example
   * Planned noop actions that execute as proposed remain silent.
   */
  it('does not create proposal briefs for proposed noop actions with receipts', () => {
    const service = createBriefSelfReviewService();

    expect(
      service.projectNightlyReviewBrief({
        agentId: 'agent-1',
        localDate: '2026-05-09',
        plan: {
          actions: [
            {
              actionType: 'noop',
              applyMode: ApplyMode.ProposalOnly,
              confidence: 0.9,
              dedupeKey: 'noop:quiet',
              evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
              idempotencyKey: 'source:noop:quiet',
              rationale: 'No self-iteration change is needed.',
              risk: Risk.Low,
            },
          ],
          plannerVersion: 'test-planner',
          reviewScope: Scope.Nightly,
          summary: 'Review found no actionable shared.',
        },
        result: {
          actions: [
            {
              idempotencyKey: 'source:noop:quiet',
              receiptId: 'source:noop:quiet:action',
              status: ActionStatus.Proposed,
              summary: 'No self-iteration change is needed.',
            },
          ],
          status: ReviewRunStatus.Completed,
        },
        reviewWindowEnd: '2026-05-09T20:00:00.000Z',
        reviewWindowStart: '2026-05-09T18:00:00.000Z',
        timezone: 'Asia/Shanghai',
        userId: 'user-1',
      }),
    ).toBeUndefined();
  });

  /**
   * @example
   * Proposal actions produce decision briefs.
   */
  it('projects proposal results to decision briefs', () => {
    const service = createBriefSelfReviewService();

    const brief = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-04',
      result: {
        actions: [
          {
            idempotencyKey: 'source:proposal_only:skill:merge',
            receiptId: 'receipt-2',
            status: ActionStatus.Proposed,
            summary: 'Review skill consolidation proposal.',
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-04T14:30:00.000Z',
      reviewWindowStart: '2026-05-03T16:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(brief).toMatchObject({
      trigger: 'agent-signal:nightly-review',
      type: 'decision',
    });
    expect(brief?.priority).toBe('normal');
    expect(brief?.summary).toContain('1 dream suggestion needs your review.');
    expect(brief?.summary).toContain('**Suggestion**');
    expect(brief?.summary).toContain('- Review skill consolidation proposal.');
  });

  /**
   * @example
   * Nightly proposal briefs use server-translated shell text before persistence.
   */
  it('projects proposal results to Chinese decision briefs', () => {
    const service = createBriefSelfReviewService();

    const brief = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      result: {
        actions: [
          {
            idempotencyKey: 'source:proposal_only:skill:merge',
            receiptId: 'receipt-2',
            status: ActionStatus.Proposed,
            summary: '检查技能合并建议。',
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-09T20:00:00.000Z',
      reviewWindowStart: '2026-05-09T18:00:00.000Z',
      t: createTranslator(zhCNBriefText),
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(brief?.title).toBe('有夜间回顾建议需要确认');
    expect(brief?.summary).toBe(
      '有 1 条夜间回顾建议需要你确认。\n\n**建议**\n- 检查技能合并建议。',
    );
    expect(brief?.type).toBe('decision');
  });

  /**
   * @example
   * Proposal briefs retain the frozen action payload needed for later approval.
   */
  it('stores frozen proposal actions on proposal briefs', () => {
    const service = createBriefSelfReviewService();
    const projected = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      plan: {
        actions: [
          {
            actionType: 'refine_skill',
            applyMode: ApplyMode.ProposalOnly,
            baseSnapshot: completeRefineSkillBaseSnapshot('adoc-1'),
            confidence: 0.91,
            dedupeKey: 'skill:adoc-1',
            evidenceRefs: [{ id: 'adoc-1', type: 'agent_document' }],
            idempotencyKey: 'source:refine_skill:skill:adoc-1',
            operation: {
              domain: 'skill',
              input: {
                patch: 'Use the existing skill index.',
                skillDocumentId: 'adoc-1',
                userId: 'user-1',
              },
              operation: 'refine',
            },
            rationale: 'Refine the managed skill instead of creating duplicate skill drafts.',
            risk: Risk.Medium,
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: Scope.Nightly,
        summary: 'Review found a skill refinement proposal.',
      },
      result: {
        actions: [
          {
            idempotencyKey: 'source:refine_skill:skill:adoc-1',
            receiptId: 'source:refine_skill:skill:adoc-1:action',
            status: ActionStatus.Proposed,
            summary: 'Refine the managed skill instead of creating duplicate skill drafts.',
          },
        ],
        sourceId: 'source',
        status: ReviewRunStatus.Completed,
        summaryReceiptId: 'source:review-summary',
      },
      reviewWindowEnd: '2026-05-09T20:00:00.000Z',
      reviewWindowStart: '2026-05-09T18:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(projected?.actions).toEqual([
      { key: 'approve', label: 'Approve', type: 'resolve' },
      { key: 'dismiss', label: 'Dismiss', type: 'resolve' },
      { key: 'feedback', label: 'Feedback', type: 'comment' },
    ]);
    const nightlySelfReview = projected?.metadata.agentSignal?.nightlySelfReview;

    expect(nightlySelfReview?.selfReviewProposal).toMatchObject({
      proposalKey: 'agent-1:refine_skill:agent_document:adoc-1',
      status: 'pending',
      version: 1,
    });
    expect(projected?.metadata).not.toHaveProperty('proposal');
    expect(nightlySelfReview?.selfReviewProposal?.actions[0]).toMatchObject({
      actionType: 'refine_skill',
      idempotencyKey: 'source:refine_skill:skill:adoc-1',
      operation: {
        domain: 'skill',
        operation: 'refine',
      },
    });
  });

  /**
   * @example
   * Mixed noop and actionable proposed results only freeze the actionable proposal metadata.
   */
  it('stores proposal metadata only for real proposed actions when noop results are mixed in', () => {
    const service = createBriefSelfReviewService();
    const projected = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      plan: {
        actions: [
          {
            actionType: 'noop',
            applyMode: ApplyMode.ProposalOnly,
            confidence: 0.9,
            dedupeKey: 'noop:quiet',
            evidenceRefs: [{ id: 'topic-1', type: 'topic' }],
            idempotencyKey: 'source:noop:quiet',
            rationale: 'No self-iteration change is needed.',
            risk: Risk.Low,
          },
          {
            actionType: 'refine_skill',
            applyMode: ApplyMode.ProposalOnly,
            baseSnapshot: completeRefineSkillBaseSnapshot('adoc-1'),
            confidence: 0.91,
            dedupeKey: 'skill:adoc-1',
            evidenceRefs: [{ id: 'adoc-1', type: 'agent_document' }],
            idempotencyKey: 'source:refine_skill:skill:adoc-1',
            operation: {
              domain: 'skill',
              input: {
                patch: 'Use the existing skill index.',
                skillDocumentId: 'adoc-1',
                userId: 'user-1',
              },
              operation: 'refine',
            },
            rationale: 'Refine the managed skill instead of creating duplicate skill drafts.',
            risk: Risk.Medium,
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: Scope.Nightly,
        summary: 'Review found one actionable proposal.',
      },
      result: {
        actions: [
          {
            idempotencyKey: 'source:noop:quiet',
            receiptId: 'source:noop:quiet:action',
            status: ActionStatus.Proposed,
            summary: 'No self-iteration change is needed.',
          },
          {
            idempotencyKey: 'source:refine_skill:skill:adoc-1',
            receiptId: 'source:refine_skill:skill:adoc-1:action',
            status: ActionStatus.Proposed,
            summary: 'Refine the managed skill instead of creating duplicate skill drafts.',
          },
        ],
        sourceId: 'source',
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-09T20:00:00.000Z',
      reviewWindowStart: '2026-05-09T18:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(getNightlySelfReview(projected)?.actionCounts.proposed).toBe(1);
    expect(projected?.summary).toBe(
      'Refine the managed skill instead of creating duplicate skill drafts.',
    );
    expect(projected?.summary).not.toContain('No self-iteration change is needed.');
    expect(getSelfReviewProposal(projected)?.actions).toHaveLength(1);
    expect(getSelfReviewProposal(projected)?.actions[0]).toMatchObject({
      actionType: 'refine_skill',
      idempotencyKey: 'source:refine_skill:skill:adoc-1',
    });
  });

  describe('specific proposal and ideas text', () => {
    const createSkillPlanAction = (index: number) => ({
      actionType: 'create_skill' as const,
      applyMode: ApplyMode.ProposalOnly,
      baseSnapshot: {
        absent: true,
        skillName: `pr-checklist-${index}`,
        targetType: 'skill' as const,
      },
      confidence: 0.9,
      dedupeKey: `skill:pr-checklist-${index}`,
      evidenceRefs: [{ id: 'topic-1', type: 'topic' as const }],
      idempotencyKey: `source:create_skill:${index}`,
      operation: {
        domain: 'skill' as const,
        input: {
          bodyMarkdown: '# PR checklist',
          description: 'Checklist for reviewing pull requests.',
          name: `pr-checklist-${index}`,
          title: index === 1 ? 'PR checklist' : `Skill ${index}`,
          userId: 'user-1',
        },
        operation: 'create' as const,
      },
      rationale:
        index === 1
          ? 'The user asked for the same PR review steps three times.'
          : `Rationale ${index}.`,
      risk: Risk.Low,
      target: { skillName: `pr-checklist-${index}` },
    });

    const projectCreateSkillProposal = (
      count: number,
      options: { summary?: string; t?: SelfReviewBriefTextTranslator } = {},
    ) => {
      const actions = Array.from({ length: count }, (_, index) => createSkillPlanAction(index + 1));

      return createBriefSelfReviewService().projectNightlyReviewBrief({
        agentId: 'agent-1',
        localDate: '2026-05-09',
        plan: {
          actions,
          plannerVersion: 'test-planner',
          reviewScope: Scope.Nightly,
          summary: options.summary ?? 'Self-review tool-first runtime completed.',
        },
        result: {
          actions: actions.map((action) => ({
            idempotencyKey: action.idempotencyKey,
            receiptId: 'proposal-receipt',
            status: ActionStatus.Proposed,
            ...(options.summary ? { summary: options.summary } : {}),
          })),
          sourceId: 'source',
          status: ReviewRunStatus.Completed,
        },
        reviewWindowEnd: '2026-05-09T20:00:00.000Z',
        reviewWindowStart: '2026-05-09T18:00:00.000Z',
        t: options.t,
        timezone: 'Asia/Shanghai',
        userId: 'user-1',
      });
    };

    /**
     * @example
     * A create_skill proposal brief names the skill and says why, not "a suggestion needs review".
     */
    it('names the proposed skill and uses the proposal summary as the body', () => {
      const brief = projectCreateSkillProposal(1, {
        summary: 'Save the PR review steps as a reusable skill.',
      });

      expect(brief?.title).toBe('New skill: PR checklist');
      expect(brief?.summary).toBe('Save the PR review steps as a reusable skill.');
      expect(getSelfReviewProposal(brief)?.summary).toBe(
        'Save the PR review steps as a reusable skill.',
      );
    });

    /**
     * @example
     * Without a proposal summary the body falls back to the action rationale.
     */
    it('falls back to the action rationale when the proposal has no summary', () => {
      const brief = projectCreateSkillProposal(1);

      expect(brief?.title).toBe('New skill: PR checklist');
      expect(brief?.summary).toBe('The user asked for the same PR review steps three times.');
      expect(getSelfReviewProposal(brief)).not.toHaveProperty('summary');
    });

    /**
     * @example
     * Multi-action proposals count the rest in the title and list every action in the body.
     */
    it('lists each action of a multi-action proposal', () => {
      const brief = projectCreateSkillProposal(2, { summary: 'Two skills would save time.' });

      expect(brief?.title).toBe('New skill: PR checklist (+1 more)');
      expect(brief?.summary).toBe(
        [
          'Two skills would save time.',
          '',
          '- **New skill: PR checklist** — The user asked for the same PR review steps three times.',
          '- **New skill: Skill 2** — Rationale 2.',
        ].join('\n'),
      );
    });

    /**
     * @example
     * Specific proposal text is rendered through the owner's translator.
     */
    it('renders the specific title through the supplied translator', () => {
      const brief = projectCreateSkillProposal(2, {
        t: createTranslator({
          ...zhCNBriefText,
          'brief.agentSignal.selfReview.kind.create_skill.withTarget': '新建技能：{{target}}',
          'brief.agentSignal.selfReview.title.more': '{{title}}（另有 {{count}} 项）',
        }),
      });

      expect(brief?.title).toBe('新建技能：PR checklist（另有 1 项）');
      expect(brief?.title).not.toBe('有夜间回顾建议需要确认');
    });

    /**
     * @example
     * Ideas-only briefs list their ideas instead of "saved dream notes".
     */
    it('lists the ideas of an ideas-only brief', () => {
      const brief = createBriefSelfReviewService().projectNightlyReviewBrief({
        agentId: 'agent-1',
        ideas: [
          {
            evidenceRefs: [],
            idempotencyKey: 'idea-1',
            rationale: 'Users often ask for weekly summaries.',
            risk: Risk.Low,
            title: 'Weekly digest',
          },
          {
            evidenceRefs: [],
            idempotencyKey: 'idea-2',
            rationale: 'Release notes keep missing the migration section.',
            risk: Risk.Low,
            target: { skillName: 'release-notes' },
          },
        ],
        localDate: '2026-05-09',
        result: { actions: [], sourceId: 'source', status: ReviewRunStatus.Completed },
        reviewWindowEnd: '2026-05-09T20:00:00.000Z',
        reviewWindowStart: '2026-05-09T18:00:00.000Z',
        timezone: 'UTC',
        userId: 'user-1',
      });

      expect(brief?.type).toBe('insight');
      expect(brief?.title).toBe('Dream note: Weekly digest (+1 more)');
      expect(brief?.summary).toBe(
        [
          '- **Dream note: Weekly digest** — Users often ask for weekly summaries.',
          '- **Dream note: release-notes** — Release notes keep missing the migration section.',
        ].join('\n'),
      );
    });
  });

  /**
   * @example
   * Failed nightly runs stay silent: a run failure is not something the user
   * can decide on, so it must not land in "Needs you".
   */
  it('does not project failed nightly outcomes to error briefs', () => {
    const service = createBriefSelfReviewService();

    const brief = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-04',
      result: {
        actions: [
          {
            idempotencyKey: 'source:write_memory:memory:concise',
            status: ActionStatus.Failed,
            summary: 'Memory service unavailable.',
          },
        ],
        status: ReviewRunStatus.Failed,
      },
      reviewWindowEnd: '2026-05-04T14:30:00.000Z',
      reviewWindowStart: '2026-05-03T16:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    expect(brief).toBeUndefined();
  });

  /**
   * @example
   * Pending self-review proposals stay visible when shared is disabled.
   */
  it('keeps pending self-review proposals visible after shared is disabled', () => {
    const service = createBriefSelfReviewService();

    expect(
      service.isSelfReviewProposalVisible({
        selfIterationEnabled: false,
        status: 'pending',
        trigger: 'agent-signal:nightly-review',
      }),
    ).toBe(true);
  });

  /**
   * @example
   * Applying a self-review proposal re-checks server, user, and agent gates.
   */
  it('blocks proposal apply when any current shared gate is disabled', async () => {
    const service = createBriefSelfReviewService();

    await expect(
      service.canApplySelfReviewProposal({
        checkAgentGate: vi.fn(async () => true),
        checkServerGate: vi.fn(async () => true),
        checkUserGate: vi.fn(async () => false),
      }),
    ).resolves.toEqual({
      allowed: false,
      reason: 'user_gate_disabled',
    });
  });

  /**
   * @example
   * Applying a self-review proposal is allowed only when all gates pass.
   */
  it('allows proposal apply when all current gates pass', async () => {
    const service = createBriefSelfReviewService();

    await expect(
      service.canApplySelfReviewProposal({
        checkAgentGate: vi.fn(async () => true),
        checkServerGate: vi.fn(async () => true),
        checkUserGate: vi.fn(async () => true),
      }),
    ).resolves.toEqual({ allowed: true });
  });

  /**
   * @example
   * The server writer persists through BriefModel.create for the source-event user.
   */
  it('creates server brief rows through BriefModel', async () => {
    const create = vi.spyOn(BriefModel.prototype, 'create').mockResolvedValue({
      agentId: 'agent-1',
      createdAt: new Date('2026-05-04T14:30:00.000Z'),
      id: 'brief-1',
      metadata: {},
      priority: 'info',
      summary: '1 dream update was applied.',
      title: 'Dream updated resources',
      trigger: 'agent-signal:nightly-review',
      type: 'insight',
      userId: 'user-1',
    } as Awaited<ReturnType<BriefModel['create']>>);
    const writer = createServerSelfReviewBriefWriter({} as never, 'user-1');
    const service = createBriefSelfReviewService();
    const brief = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-04',
      result: {
        actions: [
          {
            idempotencyKey: 'source:write_memory:memory:concise',
            receiptId: 'receipt-1',
            status: ActionStatus.Applied,
            summary: 'Saved concise PR summary preference.',
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-04T14:30:00.000Z',
      reviewWindowStart: '2026-05-03T16:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    if (!brief) throw new Error('Expected projected brief');

    await expect(writer.writeDailyBrief(brief)).resolves.toMatchObject({ id: 'brief-1' });
    expect(create).toHaveBeenCalledWith(brief);
  });

  describe('ideas brief dedupe', () => {
    const projectIdeasBrief = (localDate: string) => {
      const brief = createBriefSelfReviewService().projectNightlyReviewBrief({
        agentId: 'agent-1',
        ideas: [{ evidenceRefs: [], idempotencyKey: 'idea-1', rationale: 'Try X', risk: Risk.Low }],
        localDate,
        result: {
          actions: [],
          sourceId: `nightly:${localDate}`,
          status: ReviewRunStatus.Completed,
        },
        reviewWindowEnd: `${localDate}T14:30:00.000Z`,
        reviewWindowStart: `${localDate}T00:00:00.000Z`,
        timezone: 'UTC',
        userId: 'user-1',
      });
      if (!brief) throw new Error('Expected projected ideas brief');
      return brief;
    };

    /**
     * @example
     * A replayed idea-only completion for the same agent + local date reuses the existing brief.
     */
    it('reuses an unresolved ideas brief for the same agent and local date', async () => {
      const existing = projectIdeasBrief('2026-05-04');
      const existingRow = { ...existing, id: 'brief-ideas-1' } as unknown as Awaited<
        ReturnType<BriefModel['create']>
      >;
      const list = vi
        .spyOn(BriefModel.prototype, 'listUnresolvedByAgentAndTrigger')
        .mockResolvedValue([existingRow]);
      const create = vi.spyOn(BriefModel.prototype, 'create');
      const writer = createServerSelfReviewBriefWriter({} as never, 'user-1');

      await expect(writer.writeDailyBrief(projectIdeasBrief('2026-05-04'))).resolves.toBe(
        existingRow,
      );
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', trigger: 'agent-signal:nightly-review' }),
      );
      expect(create).not.toHaveBeenCalled();
    });

    /**
     * @example
     * An ideas brief from another local date does not block today's ideas brief.
     */
    it('creates a new ideas brief when only another local date has one', async () => {
      const existingRow = {
        ...projectIdeasBrief('2026-05-03'),
        id: 'brief-old',
      } as unknown as Awaited<ReturnType<BriefModel['create']>>;
      vi.spyOn(BriefModel.prototype, 'listUnresolvedByAgentAndTrigger').mockResolvedValue([
        existingRow,
      ]);
      const created = { id: 'brief-new' } as Awaited<ReturnType<BriefModel['create']>>;
      const create = vi.spyOn(BriefModel.prototype, 'create').mockResolvedValue(created);
      const writer = createServerSelfReviewBriefWriter({} as never, 'user-1');
      const brief = projectIdeasBrief('2026-05-04');

      await expect(writer.writeDailyBrief(brief)).resolves.toBe(created);
      expect(create).toHaveBeenCalledWith(brief);
    });
  });

  /**
   * @example
   * A compatible pending proposal refreshes the old brief instead of creating a duplicate.
   */
  it('refreshes an existing compatible pending proposal brief', async () => {
    const service = createBriefSelfReviewService();
    const incoming = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      plan: {
        actions: [
          {
            actionType: 'refine_skill',
            applyMode: ApplyMode.ProposalOnly,
            baseSnapshot: completeRefineSkillBaseSnapshot('adoc-1'),
            confidence: 0.91,
            dedupeKey: 'skill:adoc-1',
            evidenceRefs: [{ id: 'msg-new', type: 'message' }],
            idempotencyKey: 'source:new',
            operation: {
              domain: 'skill',
              input: { patch: 'new body', skillDocumentId: 'adoc-1', userId: 'user-1' },
              operation: 'refine',
            },
            rationale: 'Refresh the same proposal.',
            risk: Risk.Medium,
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: Scope.Nightly,
        summary: 'Refresh proposal.',
      },
      result: {
        actions: [
          {
            idempotencyKey: 'source:new',
            receiptId: 'receipt-new',
            status: ActionStatus.Proposed,
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-10T00:00:00.000Z',
      reviewWindowStart: '2026-05-09T22:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    if (!incoming) throw new Error('Expected projected incoming brief');
    const incomingProposal = getSelfReviewProposal(incoming);
    if (!incomingProposal) throw new Error('Expected projected proposal brief');

    const existingProposal = {
      ...incomingProposal,
      actions: [
        {
          ...incomingProposal.actions[0],
          idempotencyKey: 'source:old',
          rationale: 'Old rationale.',
        },
      ],
      createdAt: '2026-05-09T00:00:00.000Z',
      expiresAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    };
    const existingBrief = {
      agentId: 'agent-1',
      id: 'brief-old',
      metadata: {
        agentSignal: {
          nightlySelfReview: {
            selfReviewProposal: existingProposal,
          },
        },
      },
      trigger: 'agent-signal:nightly-review',
    } as Awaited<ReturnType<BriefModel['create']>>;
    const updatedBrief = {
      ...existingBrief,
      metadata: {
        agentSignal: {
          nightlySelfReview: {
            selfReviewProposal: { ...existingProposal, actions: incomingProposal.actions },
          },
        },
      },
    } as Awaited<ReturnType<BriefModel['create']>>;
    const create = vi.spyOn(BriefModel.prototype, 'create');
    const listUnresolvedByAgentAndTrigger = vi
      .spyOn(BriefModel.prototype, 'listUnresolvedByAgentAndTrigger')
      .mockResolvedValue([existingBrief]);
    const updateMetadata = vi
      .spyOn(BriefModel.prototype, 'updateMetadata')
      .mockResolvedValue(updatedBrief);
    const writer = createServerSelfReviewBriefWriter({} as never, 'user-1');

    await expect(writer.writeDailyBrief(incoming)).resolves.toBe(updatedBrief);

    expect(listUnresolvedByAgentAndTrigger).toHaveBeenCalledWith({
      agentId: 'agent-1',
      limit: 20,
      trigger: 'agent-signal:nightly-review',
    });
    expect(create).not.toHaveBeenCalled();
    expect(updateMetadata).toHaveBeenCalledWith(
      'brief-old',
      expect.objectContaining({
        agentSignal: expect.objectContaining({
          nightlySelfReview: expect.objectContaining({
            selfReviewProposal: expect.objectContaining({
              actions: incomingProposal.actions,
              status: 'pending',
            }),
          }),
        }),
      }),
    );
  });

  /**
   * @example
   * An incompatible same-key proposal supersedes the old brief and creates a new one.
   */
  it('supersedes an incompatible pending proposal before creating a replacement brief', async () => {
    const service = createBriefSelfReviewService();
    const incoming = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      plan: {
        actions: [
          {
            actionType: 'refine_skill',
            applyMode: ApplyMode.ProposalOnly,
            baseSnapshot: completeRefineSkillBaseSnapshot('adoc-1'),
            confidence: 0.91,
            dedupeKey: 'skill:adoc-1',
            evidenceRefs: [{ id: 'msg-new', type: 'message' }],
            idempotencyKey: 'source:new',
            operation: {
              domain: 'skill',
              input: { patch: 'new body', skillDocumentId: 'adoc-1', userId: 'user-1' },
              operation: 'refine',
            },
            rationale: 'Replace the old proposal.',
            risk: Risk.Medium,
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: Scope.Nightly,
        summary: 'Replacement proposal.',
      },
      result: {
        actions: [
          {
            idempotencyKey: 'source:new',
            receiptId: 'receipt-new',
            status: ActionStatus.Proposed,
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-10T00:00:00.000Z',
      reviewWindowStart: '2026-05-09T22:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    if (!incoming) throw new Error('Expected projected incoming brief');
    const incomingProposal = getSelfReviewProposal(incoming);
    if (!incomingProposal) throw new Error('Expected projected proposal brief');

    const existingProposal = incomingProposal;
    incoming.metadata.agentSignal.nightlySelfReview.selfReviewProposal = {
      ...incomingProposal,
      actions: [
        {
          ...incomingProposal.actions[0],
          operation: {
            domain: 'skill',
            input: { bodyMarkdown: 'new skill', name: 'new-skill', userId: 'user-1' },
            operation: 'create',
          },
        },
      ],
    };
    const existingBrief = {
      agentId: 'agent-1',
      id: 'brief-old',
      metadata: {
        agentSignal: {
          nightlySelfReview: {
            selfReviewProposal: existingProposal,
          },
        },
      },
      trigger: 'agent-signal:nightly-review',
    } as Awaited<ReturnType<BriefModel['create']>>;
    const createdBrief = { id: 'brief-new' } as Awaited<ReturnType<BriefModel['create']>>;
    const create = vi.spyOn(BriefModel.prototype, 'create').mockResolvedValue(createdBrief);
    vi.spyOn(BriefModel.prototype, 'listUnresolvedByAgentAndTrigger').mockResolvedValue([
      existingBrief,
    ]);
    const updateMetadata = vi
      .spyOn(BriefModel.prototype, 'updateMetadata')
      .mockResolvedValue(existingBrief);
    const writer = createServerSelfReviewBriefWriter({} as never, 'user-1');

    await expect(writer.writeDailyBrief(incoming)).resolves.toBe(createdBrief);

    expect(updateMetadata).toHaveBeenCalledWith(
      'brief-old',
      expect.objectContaining({
        agentSignal: expect.objectContaining({
          nightlySelfReview: expect.objectContaining({
            selfReviewProposal: expect.objectContaining({
              status: 'superseded',
              supersededBy:
                incoming.metadata.agentSignal.nightlySelfReview.selfReviewProposal?.proposalKey,
            }),
          }),
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith(incoming);
  });

  /**
   * @example
   * An expired pending proposal is marked expired and a fresh proposal brief is created.
   */
  it('marks expired pending proposals before creating a fresh brief', async () => {
    const service = createBriefSelfReviewService();
    const incoming = service.projectNightlyReviewBrief({
      agentId: 'agent-1',
      localDate: '2026-05-09',
      plan: {
        actions: [
          {
            actionType: 'refine_skill',
            applyMode: ApplyMode.ProposalOnly,
            baseSnapshot: completeRefineSkillBaseSnapshot('adoc-1'),
            confidence: 0.91,
            dedupeKey: 'skill:adoc-1',
            evidenceRefs: [],
            idempotencyKey: 'source:new',
            operation: {
              domain: 'skill',
              input: { patch: 'new body', skillDocumentId: 'adoc-1', userId: 'user-1' },
              operation: 'refine',
            },
            rationale: 'Create a fresh proposal.',
            risk: Risk.Medium,
            target: { skillDocumentId: 'adoc-1' },
          },
        ],
        plannerVersion: 'test-planner',
        reviewScope: Scope.Nightly,
        summary: 'Fresh proposal.',
      },
      result: {
        actions: [
          {
            idempotencyKey: 'source:new',
            receiptId: 'receipt-new',
            status: ActionStatus.Proposed,
          },
        ],
        status: ReviewRunStatus.Completed,
      },
      reviewWindowEnd: '2026-05-13T00:00:00.000Z',
      reviewWindowStart: '2026-05-12T22:00:00.000Z',
      timezone: 'Asia/Shanghai',
      userId: 'user-1',
    });

    if (!incoming) throw new Error('Expected projected incoming brief');
    const incomingProposal = getSelfReviewProposal(incoming);
    if (!incomingProposal) throw new Error('Expected projected proposal brief');

    const existingProposal = {
      ...incomingProposal,
      expiresAt: '2026-05-12T00:00:00.000Z',
      updatedAt: '2026-05-09T00:00:00.000Z',
    };
    const existingBrief = {
      agentId: 'agent-1',
      id: 'brief-old',
      metadata: {
        agentSignal: {
          nightlySelfReview: {
            selfReviewProposal: existingProposal,
          },
        },
      },
      trigger: 'agent-signal:nightly-review',
    } as Awaited<ReturnType<BriefModel['create']>>;
    const createdBrief = { id: 'brief-new' } as Awaited<ReturnType<BriefModel['create']>>;
    const create = vi.spyOn(BriefModel.prototype, 'create').mockResolvedValue(createdBrief);
    vi.spyOn(BriefModel.prototype, 'listUnresolvedByAgentAndTrigger').mockResolvedValue([
      existingBrief,
    ]);
    const updateMetadata = vi
      .spyOn(BriefModel.prototype, 'updateMetadata')
      .mockResolvedValue(existingBrief);
    const writer = createServerSelfReviewBriefWriter({} as never, 'user-1');

    await expect(writer.writeDailyBrief(incoming)).resolves.toBe(createdBrief);

    expect(updateMetadata).toHaveBeenCalledWith(
      'brief-old',
      expect.objectContaining({
        agentSignal: expect.objectContaining({
          nightlySelfReview: expect.objectContaining({
            selfReviewProposal: expect.objectContaining({ status: 'expired' }),
          }),
        }),
      }),
    );
    expect(create).toHaveBeenCalledWith(incoming);
  });
});

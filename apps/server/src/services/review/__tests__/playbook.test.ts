// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  documentHistories,
  documents,
  users,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentReviewModel } from '@/database/models/documentReview';

import { ReviewServiceError } from '../errors';
import type { ReviewLlm, ReviewLlmRequest } from '../llm';
import { ReviewPlaybookService } from '../playbook';

const CONTRACT = `# 技术服务采购合同

第 4 条 验收
乙方应完成全部交付物，并经甲方最终验收合格。

第 5 条 付款
甲方在最终验收合格后 10 个工作日内支付合同价款。

第 6 条 质量保证
质保期自最终验收合格之日起 12 个月。`;

const SUPPORTING_PAYMENT = '甲方在最终验收合格后 10 个工作日内支付合同价款';
const VIOLATING_ACCEPTANCE = '并经甲方最终验收合格';
const VIOLATING_WARRANTY = '质保期自最终验收合格之日起 12 个月';

const EDITED_ACCEPTANCE = '并经甲方分阶段验收合格';
const EDITED_WARRANTY = '质保期自分阶段验收全部通过之日起 12 个月';

type CheckMode = 'normal' | 'throw' | 'invalid-schema' | 'recheck-pass';

const parsePromptRules = (user: string): Array<{ ruleId: string; title: string }> => {
  const json = user.split('【规则】\n')[1]?.split('\n\n【文档】')[0];
  return JSON.parse(json);
};

const parseTargetQuote = (user: string): string =>
  user.split('【待修改原文 targetQuote】\n')[1]?.split('\n\n【上文】')[0]?.trim() ?? '';

describe('ReviewPlaybookService (Playbook rule checks)', () => {
  let db: LobeChatDatabase;
  let documentId: string;
  let userId: string;
  let workspaceId: string;
  let model: DocumentReviewModel;
  let service: ReviewPlaybookService;
  let checkMode: CheckMode;
  let verdicts: Map<string, any>;
  let warrantyRuleId: string;
  let llm: ReviewLlm & { generateObject: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    db = await getTestDB();
    userId = `usr_${randomUUID()}`;
    await db.insert(users).values({ id: userId });

    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Review playbook', primaryOwnerId: userId, slug: `rp-${userId}` })
      .returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values({ role: 'owner', userId, workspaceId });

    const [document] = await db
      .insert(documents)
      .values({
        content: CONTRACT,
        fileType: 'custom',
        source: `review-${userId}`,
        sourceType: 'api',
        title: '技术服务采购合同',
        totalCharCount: CONTRACT.length,
        totalLineCount: CONTRACT.split('\n').length,
        userId,
        visibility: 'private',
        workspaceId,
      })
      .returning();
    documentId = document.id;

    model = new DocumentReviewModel(db, userId, workspaceId);
    checkMode = 'normal';
    verdicts = new Map();

    llm = {
      generateObject: vi.fn(async (request: ReviewLlmRequest): Promise<unknown> => {
        if (request.schemaName === 'ReviewProposal') {
          return {
            drafts: [
              {
                instruction:
                  '文档应明确付款以验收合格为触发条件，并写明验收合格后多少工作日内付款。',
                rationale: '付款触发条件与验收方式绑定，验收标准变化会直接影响付款时点。',
                severity: 'high',
                sourceHint: { clauseLabel: '第 5 条', kind: 'clause', quote: '最终验收合格后' },
                title: '付款触发条件须与验收方式一致',
              },
              {
                instruction: '文档应写明验收是否分阶段进行、各阶段的交付物与验收标准。',
                rationale: '验收方式决定付款、质保起算与终止交付义务的时间点。',
                severity: 'high',
                sourceHint: {
                  clauseLabel: '第 4 条',
                  kind: 'clause',
                  quote: '乙方应完成全部交付物',
                },
                title: '验收方式须明确是否分阶段',
              },
              {
                instruction: '文档应明确质保期的起算时间。',
                rationale: '质保起算时间随验收方式变化。',
                severity: 'medium',
                sourceHint: {
                  clauseLabel: '第 6 条',
                  kind: 'clause',
                  quote: '质保期自最终验收合格之日起',
                },
                title: '质保起算时间须明确',
              },
            ],
          };
        }

        if (request.schemaName === 'ReviewCheckVerdicts') {
          if (checkMode === 'throw') throw new Error('provider timeout');
          if (checkMode === 'invalid-schema') {
            return { results: [{ confidence: 0.9, explanation: 'ok', verdict: 'passed' }] };
          }

          const rules = parsePromptRules(request.user);
          const results = rules.map(({ ruleId }) => {
            if (checkMode === 'recheck-pass') {
              const supporting = ruleId === warrantyRuleId ? EDITED_WARRANTY : EDITED_ACCEPTANCE;
              return {
                confidence: 0.92,
                evidence: [{ kind: 'supporting', quote: supporting }],
                explanation: '文档已按规则要求写明对应条款。',
                ruleId,
                verdict: 'passed',
              };
            }
            return { ruleId, ...verdicts.get(ruleId) };
          });

          return { results };
        }

        if (request.schemaName === 'ReviewSuggestion') {
          const targetQuote = parseTargetQuote(request.user);
          return {
            rationale: '把验收方式写成分阶段验收，付款与质保起算随之明确。',
            replacementText: targetQuote.includes('质保') ? EDITED_WARRANTY : EDITED_ACCEPTANCE,
            targetQuote,
          };
        }

        throw new Error(`Unexpected schema ${request.schemaName}`);
      }),
    };

    service = new ReviewPlaybookService({ db, llm, userId, workspaceId });
  });

  afterEach(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
  });

  const confirmRulesFromDrafts = async () => {
    const proposal = await service.proposeRules({ documentId });
    const ruleSet = await model.createRuleSet({
      documentId,
      rules: proposal.drafts.map(({ title, instruction, severity }) => ({
        instruction,
        severity,
        title,
      })),
      title: '采购合同审查',
    });
    const confirmed = (await model.confirmRuleSet(ruleSet.id))!;

    const rules = await model.listRules(ruleSet.id);
    const byTitle = (title: string) => rules.find((rule) => rule.title === title)!;

    const payment = byTitle('付款触发条件须与验收方式一致');
    const acceptance = byTitle('验收方式须明确是否分阶段');
    const warranty = byTitle('质保起算时间须明确');
    warrantyRuleId = warranty.id;

    verdicts.set(payment.id, {
      confidence: 0.9,
      evidence: [{ kind: 'supporting', quote: SUPPORTING_PAYMENT }],
      explanation: '第 5 条写明验收合格后 10 个工作日内付款。',
      verdict: 'passed',
    });
    verdicts.set(acceptance.id, {
      confidence: 0.88,
      evidence: [{ kind: 'violating', quote: VIOLATING_ACCEPTANCE }],
      explanation: '第 4 条只写最终验收，没有分阶段验收。',
      verdict: 'failed',
    });
    // Claims "passed" without evidence: the server must downgrade it.
    verdicts.set(warranty.id, {
      confidence: 0.7,
      evidence: [],
      explanation: '质保条款看似完整。',
      verdict: 'passed',
    });

    const session = await model.createSession({ documentId, ruleSetId: ruleSet.id });
    const checks = await model.initializeChecks(session.id);

    return { acceptance, checks, payment, ruleSet: confirmed, session, warranty };
  };

  it('runs proposal → confirm → check → fail → suggest → edit → apply → needs_recheck → recheck → passed', async () => {
    // 1. Proposal is a draft only: nothing is persisted.
    const proposal = await service.proposeRules({ documentId });
    expect(proposal.drafts).toHaveLength(3);
    expect(proposal.drafts[0].sourceHint?.kind).toBe('clause');
    expect(proposal.meta.promptVersion).toBe('review-proposal-v1');
    await expect(model.listRuleSets(documentId)).resolves.toHaveLength(0);

    // 2. User confirms the drafts into a rule set.
    const { acceptance, checks, payment, ruleSet, session, warranty } =
      await confirmRulesFromDrafts();
    expect(checks.map((item) => item.status)).toEqual(['unchecked', 'unchecked', 'unchecked']);
    expect(ruleSet.status).toBe('confirmed');
    const paymentCheck = checks.find((item) => item.ruleId === payment.id)!;
    const warrantyCheck = checks.find((item) => item.ruleId === warranty.id)!;

    // 3. First check: passed / failed / uncertain (no evidence → degraded).
    const checked = await service.runChecks({ sessionId: session.id });
    const byRule = new Map(checked.map((item) => [item.ruleId, item]));

    expect(byRule.get(payment.id)?.status).toBe('passed');
    const failed = byRule.get(acceptance.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.explanation).toContain('最终验收');
    const evidence = failed.evidence?.[0];
    expect(evidence?.quote).toBe(VIOLATING_ACCEPTANCE);
    expect(evidence?.start).toBe(CONTRACT.indexOf(VIOLATING_ACCEPTANCE));
    expect(evidence?.end).toBe((evidence?.start ?? 0) + VIOLATING_ACCEPTANCE.length);
    // "Passed must be evidenced": no supporting quote → uncertain.
    expect(byRule.get(warranty.id)?.status).toBe('uncertain');
    expect(byRule.get(warranty.id)?.explanation).toContain('证据不足');

    // 4. LLM failure degrades to uncertain instead of inventing a verdict.
    checkMode = 'throw';
    const paymentUnchecked = await model.transitionCheck(paymentCheck.id, { event: 'reset' });
    expect(paymentUnchecked?.status).toBe('unchecked');
    const afterError = await service.runChecks({
      checkResultIds: [paymentCheck.id],
      sessionId: session.id,
    });
    expect(afterError[0].status).toBe('uncertain');
    expect(afterError[0].explanation).toContain('模型调用失败');

    // 5. Unparseable model output also degrades to uncertain.
    checkMode = 'invalid-schema';
    await model.transitionCheck(warrantyCheck.id, { event: 'reset' });
    const afterSchema = await service.runChecks({
      checkResultIds: [warrantyCheck.id],
      sessionId: session.id,
    });
    expect(afterSchema[0].status).toBe('uncertain');
    expect(afterSchema[0].explanation).toContain('模型输出无法解析');

    // 6. Suggest a fix for the failed item, then edit it as a user would.
    checkMode = 'normal';
    const withSuggestion = await service.suggestFix({ checkResultId: failed.id });
    expect(withSuggestion.status).toBe('failed'); // generating a suggestion is not a check
    expect(withSuggestion.suggestion?.original).toBe(VIOLATING_ACCEPTANCE);

    const edited = await model.updateSuggestion(failed.id, {
      original: VIOLATING_ACCEPTANCE,
      replacement: EDITED_ACCEPTANCE,
    });
    expect(edited?.status).toBe('failed'); // editing is not a verification either

    const callsBeforeApply = llm.generateObject.mock.calls.length;

    // 7. Apply the edited suggestion → document written, item needs_recheck, PAST.
    const applied = await service.applySuggestion({
      appliedText: EDITED_ACCEPTANCE,
      checkResultId: failed.id,
    });
    expect(applied.status).toBe('needs_recheck');
    expect(applied.status).not.toBe('passed');
    expect(applied.appliedAt).toBeTruthy();
    expect(applied.suggestion).toEqual({
      original: VIOLATING_ACCEPTANCE,
      replacement: EDITED_ACCEPTANCE,
    });
    // Applying never calls the model: no verdict can be produced by an apply.
    expect(llm.generateObject.mock.calls.length).toBe(callsBeforeApply);
    // X7: a second apply on an already-invalidated item is rejected; the item
    // must be re-checked before it can produce a new suggestion.
    await expect(
      service.applySuggestion({ appliedText: '再次修改', checkResultId: failed.id }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });

    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    expect(document.content).toContain(EDITED_ACCEPTANCE);
    expect(document.content).not.toContain(VIOLATING_ACCEPTANCE);

    const histories = await db
      .select()
      .from(documentHistories)
      .where(
        and(
          eq(documentHistories.documentId, documentId),
          eq(documentHistories.saveSource, 'llm_call'),
        ),
      );
    expect(histories).toHaveLength(1);

    // 8. Apply is rejected for an unchecked item (X7), and nothing changes.
    await model.transitionCheck(warrantyCheck.id, { event: 'reset' });
    await expect(
      service.applySuggestion({ appliedText: 'x', checkResultId: warrantyCheck.id }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });

    // 9. Prepare a second needs_recheck item to prove selective recheck.
    const failedWarranty = await model.transitionCheck(warrantyCheck.id, {
      event: 'check',
      evidence: [{ end: 10, quote: VIOLATING_WARRANTY, start: 0 }],
      outcome: 'failed',
    });
    expect(failedWarranty?.status).toBe('failed');
    const warrantySuggestion = await service.suggestFix({ checkResultId: warrantyCheck.id });
    expect(warrantySuggestion.suggestion?.replacement).toBe(EDITED_WARRANTY);
    const warrantyApplied = await service.applySuggestion({
      appliedText: EDITED_WARRANTY,
      checkResultId: warrantyCheck.id,
    });
    expect(warrantyApplied.status).toBe('needs_recheck');

    // 10. Recheck ONLY the acceptance item; the warranty item stays stale.
    checkMode = 'recheck-pass';
    const rechecked = await service.recheckChecks({
      checkResultIds: [failed.id],
      sessionId: session.id,
    });
    expect(rechecked).toHaveLength(1);
    expect(rechecked[0].id).toBe(failed.id);
    expect(rechecked[0].status).toBe('passed');
    expect(rechecked[0].evidence?.[0].quote).toBe(EDITED_ACCEPTANCE);

    const stillStale = await model.findCheckResultById(warrantyCheck.id);
    expect(stillStale?.status).toBe('needs_recheck');
    // Applying a fix rewrites the body, so every other checked item is stale as
    // well: the payment verdict was reached against the pre-fix contract.
    const stalePayment = await model.findCheckResultById(paymentCheck.id);
    expect(stalePayment?.status).toBe('needs_recheck');

    // 11. "All needs_recheck" rechecks exactly that set.
    const allRechecked = await service.recheckChecks({ sessionId: session.id });
    expect(allRechecked.map((item) => item.id).sort()).toEqual(
      [paymentCheck.id, warrantyCheck.id].sort(),
    );
    expect(allRechecked.every((item) => item.status === 'passed')).toBe(true);

    // 12. A passed item is neither re-checkable through the stale-item entry
    // point nor a valid target for applying a suggestion.
    await expect(
      service.recheckChecks({ checkResultIds: [failed.id], sessionId: session.id }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    await expect(
      service.applySuggestion({ appliedText: '再次修改', checkResultId: failed.id }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
  });

  it('falls back to a pattern hint and flags duplicates when proposing from a description', async () => {
    const ruleSet = await model.createRuleSet({
      documentId,
      rules: [
        {
          instruction: '文档应写明付款以验收合格为前提，并写明付款期限。',
          title: '付款触发条件须与验收方式一致',
        },
      ],
      title: '已有规则',
    });
    await model.confirmRuleSet(ruleSet.id);

    // The model invents a clause quote that is not in the document; the server
    // must downgrade it to a pattern hint instead of dropping the draft.
    llm.generateObject.mockResolvedValueOnce({
      drafts: [
        {
          instruction: '文档应写明所有付款节点都存在前置验收条件。',
          rationale: '付款节点需要与验收条件绑定。',
          severity: 'high',
          sourceHint: { kind: 'clause', quote: '这段原文并不存在' },
          title: '所有付款节点须有前置验收条件',
        },
        {
          instruction: '文档应明确每期付款对应的验收里程碑。',
          rationale: '里程碑缺失会让付款条件无法执行。',
          severity: 'medium',
          sourceHint: null,
          title: '付款触发条件须与验收方式一致',
        },
      ],
    });

    const result = await service.proposeRules({
      description: '帮我检查所有付款节点是否都有前置验收条件',
      documentId,
    });

    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0].sourceHint).toEqual({ kind: 'pattern' });
    expect(result.drafts[1].duplicate).toBe(true);
    // Still no writes beyond the rule set created by the user above.
    await expect(model.listRuleSets(documentId)).resolves.toHaveLength(1);
  });

  it('rejects an apply whose replacement text no longer locates, without changing status', async () => {
    const { acceptance, session } = await confirmRulesFromDrafts();
    const checked = await service.runChecks({ sessionId: session.id });
    const failed = checked.find((item) => item.ruleId === acceptance.id)!;
    await service.suggestFix({ checkResultId: failed.id });

    // Simulate the user editing the document outside the checklist.
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    await db
      .update(documents)
      .set({ content: document.content!.replace(VIOLATING_ACCEPTANCE, '验收合格') })
      .where(eq(documents.id, documentId));

    await expect(
      service.applySuggestion({ appliedText: EDITED_ACCEPTANCE, checkResultId: failed.id }),
    ).rejects.toBeInstanceOf(ReviewServiceError);

    const unchanged = await model.findCheckResultById(failed.id);
    expect(unchanged?.status).toBe('failed');
  });
});

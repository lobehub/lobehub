// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  documentHistories,
  documents,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiReviewLlm } from '@/server/services/review';

import { documentReviewRouter } from '../../documentReview';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const CONTRACT = `# 技术服务采购合同

第 4 条 验收
乙方应完成全部交付物，并经甲方最终验收合格。

第 5 条 付款
甲方在最终验收合格后 10 个工作日内支付合同价款。`;

const context = (userId: string, workspaceId?: string) => ({
  jwtPayload: { userId },
  userId,
  workspaceId,
});

describe('documentReviewRouter rule-check procedures', () => {
  let db: LobeChatDatabase;
  let ownerId: string;
  let viewerId: string;
  let workspaceId: string;
  let documentId: string;
  let publicDocumentId: string;

  const caller = (userId: string, ws: string | undefined = workspaceId) =>
    documentReviewRouter.createCaller(context(userId, ws) as any);

  beforeEach(async () => {
    db = await getTestDB();
    testDB = db;
    [ownerId, viewerId] = await Promise.all([createTestUser(db), createTestUser(db)]);
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Review playbook', primaryOwnerId: ownerId, slug: `rp-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'viewer', userId: viewerId, workspaceId },
    ]);

    const base = {
      content: CONTRACT,
      fileType: 'custom',
      sourceType: 'api' as const,
      title: '技术服务采购合同',
      totalCharCount: CONTRACT.length,
      totalLineCount: CONTRACT.split('\n').length,
      userId: ownerId,
      workspaceId,
    };
    const [privateDoc, publicDoc] = await db
      .insert(documents)
      .values([
        { ...base, source: `private-${ownerId}`, visibility: 'private' },
        { ...base, source: `public-${ownerId}`, visibility: 'public' },
      ])
      .returning();
    documentId = privateDoc.id;
    publicDocumentId = publicDoc.id;

    vi.spyOn(AiReviewLlm.prototype, 'generateObject').mockImplementation(async (request) => {
      if (request.schemaName === 'ReviewProposal') {
        return {
          drafts: [
            {
              instruction: '文档应明确付款以验收合格为触发条件，并写明付款期限。',
              rationale: '付款时点受验收方式影响。',
              severity: 'high',
              sourceHint: { kind: 'pattern' },
              title: '付款触发条件须与验收方式一致',
            },
            {
              instruction: '文档应写明验收是否分阶段进行。',
              rationale: '验收方式影响付款与质保起算。',
              severity: 'high',
              sourceHint: null,
              title: '验收方式须明确是否分阶段',
            },
          ],
        };
      }

      if (request.schemaName === 'ReviewCheckVerdicts') {
        const rawRules = request.user.split('【规则】\n')[1].split('\n\n【文档】')[0];
        const rules: Array<{ ruleId: string; title: string }> = JSON.parse(rawRules);
        return {
          results: rules.map(({ ruleId, title }) =>
            title.includes('分阶段')
              ? {
                  confidence: 0.9,
                  evidence: [{ kind: 'violating', quote: '并经甲方最终验收合格' }],
                  explanation: '只写最终验收，没有分阶段验收。',
                  ruleId,
                  verdict: 'failed',
                }
              : {
                  confidence: 0.9,
                  evidence: [
                    { kind: 'supporting', quote: '甲方在最终验收合格后 10 个工作日内支付合同价款' },
                  ],
                  explanation: '付款条款写明了验收与付款期限。',
                  ruleId,
                  verdict: 'passed',
                },
          ),
        };
      }

      if (request.schemaName === 'ReviewSuggestion') {
        return {
          rationale: '改为分阶段验收。',
          replacementText: '并经甲方分阶段验收合格',
          targetQuote: '并经甲方最终验收合格',
        };
      }

      throw new Error(`Unexpected schema ${request.schemaName}`);
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await Promise.all([ownerId, viewerId].map((id) => cleanupTestUser(db, id)));
  });

  it('exposes proposal → confirm → check → suggest → apply → needs_recheck → recheck over tRPC', async () => {
    const owner = caller(ownerId);

    const proposal = await owner.proposeRules({ documentId });
    expect(proposal.drafts).toHaveLength(2);

    const ruleSet = await owner.createRuleSet({
      documentId,
      rules: proposal.drafts.map(({ title, instruction, severity }) => ({
        instruction,
        severity,
        title,
      })),
      title: '采购合同规则',
    });
    await owner.confirmRuleSet({ ruleSetId: ruleSet.id });
    const session = await owner.createSession({ documentId, ruleSetId: ruleSet.id });
    const initialized = await owner.initializeChecks({ sessionId: session.id });
    expect(initialized.every((item) => item.status === 'unchecked')).toBe(true);

    const checked = await owner.runChecks({ sessionId: session.id });
    expect(checked.map((item) => item.status).sort()).toEqual(['failed', 'passed']);

    const failed = checked.find((item) => item.status === 'failed')!;
    const withSuggestion = await owner.suggestFix({ checkResultId: failed.id });
    expect(withSuggestion.status).toBe('failed');
    expect(withSuggestion.suggestion?.original).toBe('并经甲方最终验收合格');

    const applied = await owner.applySuggestion({
      appliedText: '并经甲方分阶段验收合格',
      checkResultId: failed.id,
    });
    expect(applied.status).toBe('needs_recheck');

    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    expect(document.content).toContain('并经甲方分阶段验收合格');
    const histories = await db
      .select()
      .from(documentHistories)
      .where(eq(documentHistories.documentId, documentId));
    expect(histories.map((history) => history.saveSource)).toContain('llm_call');

    // The mocked model still quotes the pre-edit text, which no longer exists
    // after the fix; the server refuses to accept unlocatable evidence and
    // degrades the re-check to uncertain instead of claiming a verdict.
    const rechecked = await owner.recheckChecks({
      checkResultIds: [failed.id],
      sessionId: session.id,
    });
    expect(rechecked[0].status).toBe('uncertain');
  });

  it('lets a viewer read the checklist but refuses to apply a suggestion', async () => {
    const owner = caller(ownerId);
    const ruleSet = await owner.createRuleSet({
      documentId: publicDocumentId,
      rules: [
        {
          instruction: '文档应写明验收是否分阶段进行。',
          title: '验收方式须明确是否分阶段',
        },
      ],
      title: '只读检查',
    });
    await owner.confirmRuleSet({ ruleSetId: ruleSet.id });
    const session = await owner.createSession({
      documentId: publicDocumentId,
      ruleSetId: ruleSet.id,
    });
    const checks = await owner.initializeChecks({ sessionId: session.id });

    const viewer = caller(viewerId);
    // Reading is allowed…
    await expect(viewer.listCheckResults({ sessionId: session.id })).resolves.toHaveLength(1);
    // …writing is not.
    await expect(
      viewer.applySuggestion({ appliedText: 'x', checkResultId: checks[0].id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

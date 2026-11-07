// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  documentHistories,
  documentReviewImpacts,
  documentReviewSessions,
  documents,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiGenerationService } from '@/server/services/aiGeneration';
import {
  BASELINE_CONTRACT,
  CURRENT_CONTRACT,
  editorDataFromText,
  MOCK_IMPACT_RESPONSE,
} from '@/server/services/documentReviewImpact/__tests__/fixtures';

import { documentReviewRouter } from '../../documentReview';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

vi.mock('@/server/services/verify/modelConfig', () => ({
  resolveVerifyModelConfig: async () => ({ model: 'gpt-4o-mini', provider: 'openai' }),
}));

const context = (userId: string, workspaceId?: string) => ({
  jwtPayload: { userId },
  userId,
  workspaceId,
});

describe('document review impact analysis integration', () => {
  let db: LobeChatDatabase;
  let documentId: string;
  let outsiderId: string;
  let ownerId: string;
  let viewerId: string;
  let workspaceId: string;

  const caller = (userId: string) =>
    documentReviewRouter.createCaller(context(userId, workspaceId) as any);

  const generateObject = vi.spyOn(AiGenerationService.prototype, 'generateObject');

  beforeEach(async () => {
    db = await getTestDB();
    testDB = db;
    generateObject.mockReset();
    generateObject.mockResolvedValue(MOCK_IMPACT_RESPONSE);

    [ownerId, viewerId, outsiderId] = await Promise.all([
      createTestUser(db),
      createTestUser(db),
      createTestUser(db),
    ]);
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Impact analysis', primaryOwnerId: ownerId, slug: `impact-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'viewer', userId: viewerId, workspaceId },
    ]);

    const [document] = await db
      .insert(documents)
      .values({
        editorData: editorDataFromText(CURRENT_CONTRACT),
        fileType: 'custom',
        source: `impact-${ownerId}`,
        sourceType: 'api',
        title: '技术服务采购合同',
        totalCharCount: CURRENT_CONTRACT.length,
        totalLineCount: CURRENT_CONTRACT.split('\n').length,
        userId: ownerId,
        workspaceId,
      })
      .returning();
    documentId = document.id;
  });

  afterEach(async () => {
    generateObject.mockReset();
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await Promise.all([ownerId, viewerId, outsiderId].map((id) => cleanupTestUser(db, id)));
  });

  const insertBaseline = async (text = BASELINE_CONTRACT) => {
    const [history] = await db
      .insert(documentHistories)
      .values({
        documentId,
        editorData: editorDataFromText(text),
        saveSource: 'manual',
        savedAt: new Date('2026-10-01T08:00:00Z'),
        userId: ownerId,
        workspaceId,
      })
      .returning();
    return history;
  };

  it('analyses the baseline, persists anchored items and serves follow-up context', async () => {
    const history = await insertBaseline();
    const owner = caller(ownerId);
    const session = await owner.createSession({ baseHistoryId: history.id, documentId });

    const result = await owner.analyzeImpacts({ sessionId: session.id });

    expect(result.stats).toMatchObject({
      invalidAnchors: 1,
      semantic: 5,
      textual: 1,
    });
    expect(result.diff.blocks[0].before).toContain('乙方应完成全部交付物');
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(generateObject.mock.calls[0][1]).toMatchObject({
      metadata: { trigger: 'document_review' },
      tracing: {
        promptVersion: 'v1',
        scenario: 'document_review_impact',
        schemaName: 'document_review_impacts',
      },
    });

    // Persisted through the data layer, not just returned.
    const rows = await db
      .select()
      .from(documentReviewImpacts)
      .where(eq(documentReviewImpacts.sessionId, session.id));
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.title)).toEqual([
      '验收条款修改',
      '付款触发条件',
      '质保起算时间',
      '终止时交付义务',
      '「最终验收」定义',
      '附件二交叉引用',
    ]);
    expect(rows[1]).toMatchObject({
      category: 'semantic',
      confidence: 0.94,
      kind: 'obligation',
      severity: 'high',
      trigger: '「最终验收」改为「分阶段验收」',
    });
    expect(rows[1].sourceAnchor).toMatchObject({ quote: '分阶段验收' });
    expect(rows[1].relatedAnchor).toMatchObject({
      label: '第 3 条 付款',
      quote: '甲方在最终验收合格后 10 个工作日内支付合同价款的 90%',
    });
    // The unlocatable anchor is stored with `invalid`, not dropped.
    expect(rows[5].relatedAnchor).toMatchObject({
      invalid: true,
      quote: '附件二第三条约定最终验收的组织方式',
    });

    // The session view returns the same persisted rows.
    const loaded = await owner.getSession({ sessionId: session.id });
    expect(loaded.impacts).toHaveLength(6);
    expect(loaded.impacts[1].confidence).toBeCloseTo(0.94);

    // Re-running replaces the previous analysis instead of appending.
    await owner.analyzeImpacts({ sessionId: session.id });
    const afterRerun = await db
      .select()
      .from(documentReviewImpacts)
      .where(eq(documentReviewImpacts.sessionId, session.id));
    expect(afterRerun).toHaveLength(6);

    // Replacement mints new ids, so re-read the session before following up.
    const reloaded = await owner.getSession({ sessionId: session.id });

    // Follow-up context is assembled from the impact row plus both excerpts.
    const followUp = await owner.getImpactFollowUpContext({
      impactId: reloaded.impacts[1].id,
      question: '付款节点应该怎么改？',
    });
    expect(followUp.impact.title).toBe('付款触发条件');
    expect(followUp.source).toMatchObject({ quote: '分阶段验收', status: 'located' });
    expect(followUp.related).toMatchObject({
      quote: '甲方在最终验收合格后 10 个工作日内支付合同价款的 90%',
      status: 'located',
    });
    expect(followUp.messages[1].content).toContain('付款节点应该怎么改？');

    const invalidFollowUp = await owner.getImpactFollowUpContext({
      impactId: reloaded.impacts[5].id,
    });
    expect(invalidFollowUp.related).toMatchObject({
      quote: '附件二第三条约定最终验收的组织方式',
      status: 'invalid',
    });

    // A viewer may read the analysis but not run it.
    await expect(caller(viewerId).analyzeImpacts({ sessionId: session.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      caller(viewerId).getImpactFollowUpContext({ impactId: reloaded.impacts[1].id }),
    ).resolves.toMatchObject({ impact: { title: '付款触发条件' } });

    // A non-member sees nothing.
    await expect(caller(outsiderId).getSession({ sessionId: session.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('returns explicit errors for a missing baseline and an unchanged document', async () => {
    const owner = caller(ownerId);

    const withoutBaseline = await owner.createSession({ documentId });
    await expect(owner.analyzeImpacts({ sessionId: withoutBaseline.id })).rejects.toMatchObject({
      cause: { code: 'NO_BASELINE' },
      code: 'PRECONDITION_FAILED',
    });

    const sameHistory = await insertBaseline(CURRENT_CONTRACT);
    const unchanged = await owner.createSession({
      baseHistoryId: sameHistory.id,
      documentId,
    });
    await expect(owner.analyzeImpacts({ sessionId: unchanged.id })).rejects.toMatchObject({
      cause: { code: 'NO_DIFF' },
      code: 'PRECONDITION_FAILED',
    });

    const unknownHistory = await owner.createSession({
      baseHistoryId: 'hist_missing',
      documentId,
    });
    await expect(owner.analyzeImpacts({ sessionId: unknownHistory.id })).rejects.toMatchObject({
      cause: { code: 'BASELINE_NOT_FOUND' },
      code: 'NOT_FOUND',
    });
  });

  it('distinguishes a model failure from off-schema output', async () => {
    const history = await insertBaseline();
    const owner = caller(ownerId);
    const session = await owner.createSession({ baseHistoryId: history.id, documentId });

    generateObject.mockRejectedValueOnce(new Error('provider timeout'));
    await expect(owner.analyzeImpacts({ sessionId: session.id })).rejects.toMatchObject({
      cause: { code: 'LLM_FAILED' },
      code: 'BAD_GATEWAY',
    });

    generateObject.mockResolvedValueOnce({ items: [{ kind: 'nonsense' }] });
    await expect(owner.analyzeImpacts({ sessionId: session.id })).rejects.toMatchObject({
      cause: { code: 'SCHEMA_INVALID' },
      code: 'INTERNAL_SERVER_ERROR',
    });

    // A failed run leaves the previous analysis untouched (none was written).
    const rows = await db
      .select()
      .from(documentReviewImpacts)
      .where(eq(documentReviewImpacts.sessionId, session.id));
    expect(rows).toHaveLength(0);
    expect(
      await db
        .select()
        .from(documentReviewSessions)
        .where(eq(documentReviewSessions.id, session.id)),
    ).toHaveLength(1);
  });
});

// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  documentReviewCheckResults,
  documents,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { documentReviewRouter } from '../../documentReview';
import { cleanupTestUser, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const context = (userId: string, workspaceId?: string) => ({
  jwtPayload: { userId },
  userId,
  workspaceId,
});

describe('documentReviewRouter integration', () => {
  let db: LobeChatDatabase;
  let documentId: string;
  let privateDocumentId: string;
  let memberId: string;
  let outsiderId: string;
  let ownerId: string;
  let viewerId: string;
  let workspaceId: string;

  const caller = (userId: string, ws: string | undefined = workspaceId) =>
    documentReviewRouter.createCaller(context(userId, ws) as any);

  beforeEach(async () => {
    db = await getTestDB();
    testDB = db;
    [ownerId, memberId, viewerId, outsiderId] = await Promise.all([
      createTestUser(db),
      createTestUser(db),
      createTestUser(db),
      createTestUser(db),
    ]);
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Document review', primaryOwnerId: ownerId, slug: `drv-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
      { role: 'viewer', userId: viewerId, workspaceId },
    ]);
    const base = {
      fileType: 'custom',
      sourceType: 'api' as const,
      totalCharCount: 0,
      totalLineCount: 0,
      userId: ownerId,
      workspaceId,
    };
    const [document, privateDocument] = await db
      .insert(documents)
      .values([
        { ...base, source: `review-${ownerId}`, title: '采购合同', visibility: 'public' },
        { ...base, source: `private-${ownerId}`, title: '私有合同', visibility: 'private' },
      ])
      .returning();
    documentId = document.id;
    privateDocumentId = privateDocument.id;
  });

  afterEach(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await Promise.all(
      [ownerId, memberId, viewerId, outsiderId].map((id) => cleanupTestUser(db, id)),
    );
  });

  const setupChecklist = async () => {
    const owner = caller(ownerId);
    const ruleSet = await owner.createRuleSet({
      documentId,
      rules: [
        { instruction: '付款触发条件须与验收方式一致', title: '付款触发' },
        { instruction: '质保期起算时间须明确', title: '质保起算' },
      ],
      title: '采购合同规则',
    });
    await owner.confirmRuleSet({ ruleSetId: ruleSet.id });
    const session = await owner.createSession({ documentId, ruleSetId: ruleSet.id });
    const checks = await owner.initializeChecks({ sessionId: session.id });
    return { checks, ruleSet, session };
  };

  it('runs the full session → impacts → rules → checklist flow', async () => {
    const owner = caller(ownerId);
    const { checks, session } = await setupChecklist();
    await owner.replaceImpacts({
      items: [
        {
          category: 'textual',
          kind: 'related_clause',
          reason: '最终验收改为分阶段验收',
          title: '验收条款',
        },
        {
          category: 'semantic',
          kind: 'obligation',
          reason: '付款以最终验收为触发',
          relatedAnchor: { quote: '最终验收合格后' },
          severity: 'high',
          title: '付款触发条件',
        },
      ],
      sessionId: session.id,
    });

    const detail = await owner.getSession({ sessionId: session.id });
    expect(detail.impacts.map((i) => i.category)).toEqual(['textual', 'semantic']);
    expect(detail.checkResults.map((c) => c.status)).toEqual(['unchecked', 'unchecked']);
    expect(detail.ruleSet?.status).toBe('confirmed');
    expect(checks).toHaveLength(2);
  });

  describe('check status transitions', () => {
    it('apply → needs_recheck; only a re-check yields passed; apply → passed is rejected', async () => {
      const owner = caller(ownerId);
      const { checks } = await setupChecklist();
      const checkResultId = checks[0].id;

      await owner.transitionCheck({
        checkResultId,
        event: 'check',
        explanation: '付款仍以最终验收为触发条件',
        outcome: 'failed',
        suggestion: { original: '最终验收合格后', replacement: '各阶段验收合格后' },
      });

      const applied = await owner.transitionCheck({ checkResultId, event: 'apply_suggestion' });
      expect(applied.status).toBe('needs_recheck');

      await expect(
        owner.transitionCheck({ checkResultId, event: 'apply_suggestion', outcome: 'passed' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const [stored] = await db
        .select({ status: documentReviewCheckResults.status })
        .from(documentReviewCheckResults)
        .where(eq(documentReviewCheckResults.id, checkResultId));
      expect(stored.status).toBe('needs_recheck');

      const rechecked = await owner.transitionCheck({
        checkResultId,
        event: 'check',
        outcome: 'passed',
      });
      expect(rechecked.status).toBe('passed');
    });

    it('rejects applying a fix to an unchecked result with CONFLICT', async () => {
      const { checks } = await setupChecklist();
      await expect(
        caller(ownerId).transitionCheck({ checkResultId: checks[0].id, event: 'apply_suggestion' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('ignores a client-supplied status: apply with status=passed still lands on needs_recheck', async () => {
      const owner = caller(ownerId);
      const { checks } = await setupChecklist();
      await owner.transitionCheck({
        checkResultId: checks[0].id,
        event: 'check',
        outcome: 'failed',
      });

      const result = await owner.transitionCheck({
        checkResultId: checks[0].id,
        event: 'apply_suggestion',
        status: 'passed',
      } as any);
      expect(result.status).toBe('needs_recheck');
    });

    it('refuses to check an unconfirmed rule set', async () => {
      const owner = caller(ownerId);
      const ruleSet = await owner.createRuleSet({
        documentId,
        rules: [{ instruction: 'x', title: 'x' }],
        title: 'draft',
      });
      const session = await owner.createSession({ documentId, ruleSetId: ruleSet.id });
      await expect(owner.initializeChecks({ sessionId: session.id })).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });
  });

  describe('document access control', () => {
    it('lets a viewer read but not change a review', async () => {
      const { checks, ruleSet, session } = await setupChecklist();
      const viewer = caller(viewerId);

      await expect(viewer.getSession({ sessionId: session.id })).resolves.toBeTruthy();
      await expect(viewer.listRuleSets({ documentId })).resolves.toHaveLength(1);

      await expect(viewer.createSession({ documentId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(viewer.confirmRuleSet({ ruleSetId: ruleSet.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        viewer.transitionCheck({ checkResultId: checks[0].id, event: 'check', outcome: 'passed' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('lets a member edit a public document review', async () => {
      const { checks } = await setupChecklist();
      await expect(
        caller(memberId).transitionCheck({
          checkResultId: checks[0].id,
          event: 'check',
          outcome: 'uncertain',
        }),
      ).resolves.toMatchObject({ status: 'uncertain' });
    });

    it("hides another member's private document review", async () => {
      const owner = caller(ownerId);
      const session = await owner.createSession({ documentId: privateDocumentId });

      await expect(
        caller(memberId).listSessions({ documentId: privateDocumentId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller(memberId).getSession({ sessionId: session.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('refuses a non-member and a caller from another workspace', async () => {
      const { session } = await setupChecklist();
      await expect(caller(outsiderId).listSessions({ documentId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });

      const [otherWorkspace] = await db
        .insert(workspaces)
        .values({ name: 'Other', primaryOwnerId: outsiderId, slug: `drv-other-${outsiderId}` })
        .returning();
      await db
        .insert(workspaceMembers)
        .values({ role: 'owner', userId: outsiderId, workspaceId: otherWorkspace.id });
      try {
        await expect(
          caller(outsiderId, otherWorkspace.id).getSession({ sessionId: session.id }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(
          caller(outsiderId, otherWorkspace.id).listSessions({ documentId }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } finally {
        await db.delete(workspaces).where(eq(workspaces.id, otherWorkspace.id));
      }
    });

    it('requires a workspace', async () => {
      const personal = documentReviewRouter.createCaller(context(ownerId) as any);
      await expect(personal.listSessions({ documentId })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });
});

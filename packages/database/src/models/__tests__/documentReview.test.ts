// @vitest-environment node
import { DocumentReviewTransitionError } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  documentReviewCheckResults,
  documentReviewRuleSets,
  documentReviewSessions,
  documents,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { DOCUMENT_TRANSFER_FOREIGN_ROWS, DocumentModel } from '../document';
import {
  DOCUMENT_REVIEW_DOCUMENT_NOT_FOUND,
  DOCUMENT_REVIEW_RULE_SET_EMPTY,
  DOCUMENT_REVIEW_RULE_SET_MISMATCH,
  DOCUMENT_REVIEW_RULE_SET_NOT_CONFIRMED,
  DOCUMENT_REVIEW_WORKSPACE_REQUIRED,
  DocumentReviewModel,
} from '../documentReview';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'document-review-owner';
const outsiderId = 'document-review-outsider';
const workspaceId = 'document-review-workspace';
const otherWorkspaceId = 'document-review-other-workspace';
const documentId = 'document-review-document';
const secondDocumentId = 'document-review-second-document';
const foreignDocumentId = 'document-review-foreign-document';

const model = new DocumentReviewModel(serverDB, ownerId, workspaceId);
const outsiderModel = new DocumentReviewModel(serverDB, outsiderId, otherWorkspaceId);

const createDocument = (id: string, userId: string, targetWorkspaceId: string | null) =>
  serverDB.insert(documents).values({
    fileType: 'custom',
    id,
    source: id,
    sourceType: 'api',
    totalCharCount: 0,
    totalLineCount: 0,
    userId,
    workspaceId: targetWorkspaceId,
  });

const cleanup = async () => {
  await serverDB.delete(workspaces);
  await serverDB.delete(users);
};

beforeEach(async () => {
  await cleanup();
  await serverDB.insert(users).values([{ id: ownerId }, { id: outsiderId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'Review', primaryOwnerId: ownerId, slug: workspaceId },
    { id: otherWorkspaceId, name: 'Other', primaryOwnerId: outsiderId, slug: otherWorkspaceId },
  ]);
  await Promise.all([
    createDocument(documentId, ownerId, workspaceId),
    createDocument(secondDocumentId, ownerId, workspaceId),
    createDocument(foreignDocumentId, outsiderId, otherWorkspaceId),
  ]);
});

afterEach(cleanup);

const RULES = [
  { instruction: '付款触发条件须与验收方式一致', title: '付款触发', severity: 'high' as const },
  { instruction: '质保期起算时间须明确', title: '质保起算' },
];

/** A session with a confirmed two-rule set and initialized check results. */
const setupChecklist = async () => {
  const ruleSet = await model.createRuleSet({ documentId, rules: RULES, title: '采购合同规则' });
  await model.confirmRuleSet(ruleSet.id);
  const session = await model.createSession({ documentId, ruleSetId: ruleSet.id });
  const checks = await model.initializeChecks(session.id);
  return { checks, ruleSet, session };
};

describe('DocumentReviewModel', () => {
  describe('scope', () => {
    it('requires a workspace', async () => {
      const personal = new DocumentReviewModel(serverDB, ownerId);
      await expect(personal.createSession({ documentId })).rejects.toThrow(
        DOCUMENT_REVIEW_WORKSPACE_REQUIRED,
      );
    });

    it('refuses a document from another workspace', async () => {
      await expect(model.createSession({ documentId: foreignDocumentId })).rejects.toThrow(
        DOCUMENT_REVIEW_DOCUMENT_NOT_FOUND,
      );
      await expect(
        model.createRuleSet({ documentId: foreignDocumentId, title: 'x' }),
      ).rejects.toThrow(DOCUMENT_REVIEW_DOCUMENT_NOT_FOUND);
    });

    it('hides every row from another workspace', async () => {
      const { checks, ruleSet, session } = await setupChecklist();
      const [impact] = await model.replaceImpacts(session.id, [
        { category: 'semantic', kind: 'obligation', reason: 'r', title: 't' },
      ]);

      expect(await outsiderModel.findSessionById(session.id)).toBeUndefined();
      expect(await outsiderModel.findRuleSetById(ruleSet.id)).toBeUndefined();
      expect(await outsiderModel.findImpactById(impact.id)).toBeUndefined();
      expect(await outsiderModel.findCheckResultById(checks[0].id)).toBeUndefined();
      expect(await outsiderModel.listImpacts(session.id)).toEqual([]);
      expect(await outsiderModel.listCheckResults(session.id)).toEqual([]);
      expect(await outsiderModel.deleteSession(session.id)).toBe(false);
      expect(
        await outsiderModel.transitionCheck(checks[0].id, { event: 'check', outcome: 'passed' }),
      ).toBeUndefined();
      expect((await model.findCheckResultById(checks[0].id))?.status).toBe('unchecked');
    });
  });

  describe('sessions & impacts', () => {
    it('creates, lists, updates and deletes sessions', async () => {
      const session = await model.createSession({ documentId, title: 'v2 修订' });
      expect(session.id).toMatch(/^drs_/);
      expect(session).toMatchObject({ status: 'active', userId: ownerId, workspaceId });

      expect((await model.listSessions(documentId)).map((s) => s.id)).toEqual([session.id]);
      expect(await model.updateSession(session.id, { status: 'archived' })).toMatchObject({
        status: 'archived',
      });
      expect(await model.deleteSession(session.id)).toBe(true);
      expect(await model.findSessionById(session.id)).toBeUndefined();
    });

    it('replaces impacts in order and distinguishes textual from semantic', async () => {
      const session = await model.createSession({ documentId });
      await model.replaceImpacts(session.id, [
        { category: 'textual', kind: 'related_clause', reason: 'old', title: 'old' },
      ]);
      const items = await model.replaceImpacts(session.id, [
        {
          category: 'textual',
          kind: 'related_clause',
          reason: '最终验收改为分阶段验收',
          sourceAnchor: { label: '§5 验收', quote: '分阶段验收' },
          title: '验收条款修改',
        },
        {
          category: 'semantic',
          kind: 'obligation',
          reason: '付款以“最终验收”为触发条件，需确认分阶段后的付款节点',
          relatedAnchor: { label: '§7 付款', quote: '最终验收合格后' },
          severity: 'high',
          title: '付款触发条件',
        },
      ]);

      const listed = await model.listImpacts(session.id);
      expect(listed.map((i) => [i.title, i.category, i.sortOrder])).toEqual([
        ['验收条款修改', 'textual', 0],
        ['付款触发条件', 'semantic', 1],
      ]);
      expect(listed[1].relatedAnchor).toEqual({ label: '§7 付款', quote: '最终验收合格后' });
      expect(await model.updateImpactStatus(items[1].id, 'acknowledged')).toMatchObject({
        status: 'acknowledged',
      });
      expect(await model.replaceImpacts(session.id, [])).toEqual([]);
    });
  });

  describe('rule sets', () => {
    it('supports CRUD and drops back to draft on any rule edit', async () => {
      const ruleSet = await model.createRuleSet({ documentId, rules: RULES, title: 'Playbook' });
      expect(ruleSet.id).toMatch(/^drrs_/);
      expect(ruleSet).toMatchObject({ status: 'draft' });
      expect(ruleSet.rules.map((r) => [r.title, r.sortOrder, r.severity])).toEqual([
        ['付款触发', 0, 'high'],
        ['质保起算', 1, 'medium'],
      ]);

      const confirmed = await model.confirmRuleSet(ruleSet.id);
      expect(confirmed).toMatchObject({ confirmedByUserId: ownerId, status: 'confirmed' });

      const added = await model.addRule(ruleSet.id, { instruction: 'i', title: '终止交付' });
      expect(added.sortOrder).toBe(2);
      expect((await model.findRuleSetById(ruleSet.id))?.status).toBe('draft');

      await model.confirmRuleSet(ruleSet.id);
      await model.updateRule(added.id, { title: '终止时交付义务' });
      expect((await model.findRuleSetById(ruleSet.id))?.status).toBe('draft');

      await model.confirmRuleSet(ruleSet.id);
      expect(await model.removeRule(added.id)).toBe(true);
      expect(await model.removeRule(added.id)).toBe(false);
      expect((await model.findRuleSetById(ruleSet.id))?.status).toBe('draft');

      expect(await model.updateRuleSet(ruleSet.id, { title: 'Renamed' })).toMatchObject({
        title: 'Renamed',
      });
      expect((await model.listRuleSets(documentId)).map((r) => r.id)).toEqual([ruleSet.id]);
      expect(await model.deleteRuleSet(ruleSet.id)).toBe(true);
      expect(await model.findRuleSetById(ruleSet.id)).toBeUndefined();
    });

    it('refuses to confirm an empty rule set', async () => {
      const ruleSet = await model.createRuleSet({ documentId, title: 'Empty' });
      await expect(model.confirmRuleSet(ruleSet.id)).rejects.toThrow(
        DOCUMENT_REVIEW_RULE_SET_EMPTY,
      );
    });

    it('refuses to attach a rule set of another document', async () => {
      const ruleSet = await model.createRuleSet({ documentId: secondDocumentId, title: 'Other' });
      await expect(model.createSession({ documentId, ruleSetId: ruleSet.id })).rejects.toThrow(
        DOCUMENT_REVIEW_RULE_SET_MISMATCH,
      );
    });

    it('only checks a confirmed rule set', async () => {
      const ruleSet = await model.createRuleSet({ documentId, rules: RULES, title: 'Draft' });
      const session = await model.createSession({ documentId, ruleSetId: ruleSet.id });
      await expect(model.initializeChecks(session.id)).rejects.toThrow(
        DOCUMENT_REVIEW_RULE_SET_NOT_CONFIRMED,
      );
    });
  });

  describe('check results & transitions', () => {
    it('initializes one unchecked result per rule, idempotently', async () => {
      const { checks, session } = await setupChecklist();
      expect(checks.map((c) => c.status)).toEqual(['unchecked', 'unchecked']);
      expect(await model.initializeChecks(session.id)).toHaveLength(2);
    });

    it('after applying a fix the result is needs_recheck; only a re-check makes it passed', async () => {
      const { checks } = await setupChecklist();
      const id = checks[0].id;

      const failed = await model.transitionCheck(id, {
        event: 'check',
        evidence: [{ quote: '最终验收合格后支付全部款项' }],
        explanation: '付款仍以最终验收为触发条件',
        outcome: 'failed',
        suggestion: { original: '最终验收合格后', replacement: '各阶段验收合格后' },
      });
      expect(failed).toMatchObject({ explanation: '付款仍以最终验收为触发条件', status: 'failed' });
      expect(failed?.checkedAt).toBeInstanceOf(Date);

      const edited = await model.updateSuggestion(id, {
        original: '最终验收合格后',
        replacement: '对应阶段验收合格后',
      });
      expect(edited?.status).toBe('failed');

      const applied = await model.transitionCheck(id, { event: 'apply_suggestion' });
      expect(applied?.status).toBe('needs_recheck');
      expect(applied?.appliedAt).toBeInstanceOf(Date);
      expect(applied?.suggestion?.replacement).toBe('对应阶段验收合格后');

      // apply → passed is rejected and leaves the row untouched.
      await expect(
        model.transitionCheck(id, { event: 'apply_suggestion', outcome: 'passed' }),
      ).rejects.toBeInstanceOf(DocumentReviewTransitionError);
      expect((await model.findCheckResultById(id))?.status).toBe('needs_recheck');

      const rechecked = await model.transitionCheck(id, { event: 'check', outcome: 'passed' });
      expect(rechecked?.status).toBe('passed');
      expect(rechecked?.suggestion).toBeNull();
    });

    it('drops the previous suggestion when a fresh check commits a new verdict', async () => {
      const { checks } = await setupChecklist();
      const id = checks[0].id;

      const failed = await model.transitionCheck(id, {
        event: 'check',
        evidence: [{ quote: '最终验收合格后支付全部款项' }],
        explanation: '付款仍以最终验收为触发条件',
        outcome: 'failed',
        suggestion: { original: '最终验收合格后', replacement: '各阶段验收合格后' },
      });
      expect(failed?.suggestion?.original).toBe('最终验收合格后');

      // The re-check fails against different text: the stored fix no longer has
      // a target, so offering it again would only produce ANCHOR_LOST on Apply.
      const rechecked = await model.transitionCheck(id, {
        event: 'check',
        evidence: [{ quote: '支付全部款项' }],
        explanation: '仍未约定验收标准',
        outcome: 'failed',
      });
      expect(rechecked).toMatchObject({ explanation: '仍未约定验收标准', status: 'failed' });
      expect(rechecked?.suggestion).toBeNull();

      // A caller that did compute a new fix still replaces it in one write.
      const withFix = await model.transitionCheck(id, {
        event: 'check',
        evidence: [{ quote: '支付全部款项' }],
        explanation: '仍未约定验收标准',
        outcome: 'failed',
        suggestion: { original: '支付全部款项', replacement: '支付全部款项，验收标准见附件一' },
      });
      expect(withFix?.suggestion?.replacement).toBe('支付全部款项，验收标准见附件一');
    });

    it('refuses to apply a fix to a passed or unchecked result', async () => {
      const { checks } = await setupChecklist();
      await expect(
        model.transitionCheck(checks[0].id, { event: 'apply_suggestion' }),
      ).rejects.toMatchObject({ code: 'illegal_transition' });

      await model.transitionCheck(checks[1].id, { event: 'check', outcome: 'passed' });
      await expect(
        model.transitionCheck(checks[1].id, { event: 'apply_suggestion' }),
      ).rejects.toMatchObject({ code: 'illegal_transition' });
    });

    it('reset clears the result', async () => {
      const { checks } = await setupChecklist();
      await model.transitionCheck(checks[0].id, {
        event: 'check',
        explanation: 'x',
        outcome: 'uncertain',
      });
      const reset = await model.transitionCheck(checks[0].id, { event: 'reset' });
      expect(reset).toMatchObject({ checkedAt: null, explanation: null, status: 'unchecked' });
    });

    it('editing a rule or the document invalidates checked results', async () => {
      const { checks, ruleSet } = await setupChecklist();
      await model.transitionCheck(checks[0].id, { event: 'check', outcome: 'passed' });

      await model.updateRule(ruleSet.rules[0].id, { instruction: 'changed' });
      expect((await model.findCheckResultById(checks[0].id))?.status).toBe('needs_recheck');
      expect((await model.findCheckResultById(checks[1].id))?.status).toBe('unchecked');

      await model.transitionCheck(checks[0].id, { event: 'check', outcome: 'passed' });
      await model.transitionCheck(checks[1].id, { event: 'check', outcome: 'failed' });
      expect(await model.invalidateDocumentChecks(documentId)).toBe(2);
      expect((await model.listCheckResults(checks[0].sessionId)).map((c) => c.status)).toEqual([
        'needs_recheck',
        'needs_recheck',
      ]);
    });

    it('rejects a verdict computed from a stale document or rule revision', async () => {
      const { checks } = await setupChecklist();
      const id = checks[0].id;

      const [document] = await serverDB
        .select({ updatedAt: documents.updatedAt })
        .from(documents)
        .where(eq(documents.id, documentId));
      const rule = (await model.findRuleById(checks[0].ruleId))!;
      const expectedRevisions = {
        documentUpdatedAt: document.updatedAt,
        ruleUpdatedAt: rule.updatedAt,
      };

      // Unchanged revisions still commit: the guard is not a blanket rejection.
      const fresh = await model.transitionCheck(id, {
        event: 'check',
        expectedRevisions,
        outcome: 'passed',
      });
      expect(fresh?.status).toBe('passed');

      // The body moves after the verdict was computed (autosave), so the same
      // revisions no longer describe the document: the verdict is discarded and
      // the row keeps `needs_recheck` instead of passing stale content.
      await model.invalidateDocumentChecks(documentId);
      await serverDB
        .update(documents)
        .set({ updatedAt: new Date(document.updatedAt.getTime() + 1000) })
        .where(eq(documents.id, documentId));

      const stale = await model.transitionCheck(id, {
        event: 'check',
        expectedRevisions,
        outcome: 'passed',
      });
      expect(stale?.status).toBe('needs_recheck');
      expect((await model.findCheckResultById(id))?.status).toBe('needs_recheck');
    });

    it('switching the session rule set discards stale results', async () => {
      const { session } = await setupChecklist();
      const other = await model.createRuleSet({ documentId, rules: RULES, title: 'Other' });
      await model.updateSession(session.id, { ruleSetId: other.id });
      expect(await model.listCheckResults(session.id)).toEqual([]);
    });
  });

  describe('document transfer', () => {
    it('rehomes review rows with the document', async () => {
      const { session } = await setupChecklist();
      await new DocumentModel(serverDB, ownerId, workspaceId).transferTo(
        documentId,
        otherWorkspaceId,
        ownerId,
      );

      const [moved] = await serverDB
        .select()
        .from(documentReviewSessions)
        .where(eq(documentReviewSessions.id, session.id));
      expect(moved.workspaceId).toBe(otherWorkspaceId);
      const results = await serverDB
        .select({ workspaceId: documentReviewCheckResults.workspaceId })
        .from(documentReviewCheckResults)
        .where(eq(documentReviewCheckResults.sessionId, session.id));
      expect(results.every((r) => r.workspaceId === otherWorkspaceId)).toBe(true);
    });

    it("treats another member's review as a foreign row for a non-owner transfer", async () => {
      await serverDB.insert(users).values({ id: 'document-review-member' });
      const memberModel = new DocumentReviewModel(serverDB, 'document-review-member', workspaceId);
      await memberModel.createSession({ documentId });

      await expect(
        new DocumentModel(serverDB, ownerId, workspaceId).transferTo(
          documentId,
          otherWorkspaceId,
          ownerId,
          undefined,
          { forbidForeignRows: true },
        ),
      ).rejects.toThrow(DOCUMENT_TRANSFER_FOREIGN_ROWS);
    });

    it('drops review rows when the document moves to personal scope', async () => {
      await setupChecklist();
      await new DocumentModel(serverDB, ownerId, workspaceId).transferTo(documentId, null, ownerId);
      expect(
        await serverDB
          .select()
          .from(documentReviewRuleSets)
          .where(eq(documentReviewRuleSets.documentId, documentId)),
      ).toEqual([]);
    });
  });
});

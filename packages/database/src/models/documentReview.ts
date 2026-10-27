import type {
  DocumentReviewCheckEvent,
  DocumentReviewCheckOutcome,
  DocumentReviewCheckSuggestion,
  DocumentReviewImpactInput,
  DocumentReviewImpactStatus,
  DocumentReviewRuleInput,
  DocumentReviewSessionStatus,
  DocumentReviewTextAnchor,
} from '@lobechat/types';
import { resolveDocumentReviewCheckTransition } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';

import type {
  DocumentReviewCheckResultItem,
  DocumentReviewImpactItem,
  DocumentReviewRuleItem,
  DocumentReviewRuleSetItem,
  DocumentReviewSessionItem,
} from '../schemas/documentReview';
import {
  documentReviewCheckResults,
  documentReviewImpacts,
  documentReviewRules,
  documentReviewRuleSets,
  documentReviewSessions,
} from '../schemas/documentReview';
import { documents } from '../schemas/file';
import type { LobeChatDatabase } from '../type';
import { notTrashed } from '../utils/softDelete';

export const DOCUMENT_REVIEW_WORKSPACE_REQUIRED =
  'Document reviews are workspace-scoped; a workspaceId is required';
export const DOCUMENT_REVIEW_DOCUMENT_NOT_FOUND = 'Document not found in current workspace';
export const DOCUMENT_REVIEW_NOT_FOUND = 'Document review resource not found';
export const DOCUMENT_REVIEW_RULE_SET_MISMATCH =
  'The rule set does not belong to the reviewed document';
export const DOCUMENT_REVIEW_RULE_SET_NOT_CONFIRMED =
  'The rule set must be confirmed before it can be checked';
export const DOCUMENT_REVIEW_RULE_SET_EMPTY = 'A rule set needs at least one rule to be confirmed';

/** Revision comparison for the stale-verdict guard; both sides must exist. */
const sameRevision = (a?: Date | null, b?: Date | null): boolean =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

export interface DocumentReviewRuleSetWithRules extends DocumentReviewRuleSetItem {
  rules: DocumentReviewRuleItem[];
}

export interface TransitionCheckParams {
  event: DocumentReviewCheckEvent;
  evidence?: DocumentReviewTextAnchor[] | null;
  /**
   * Versions captured before the LLM call that produced a `check` verdict.
   * A verdict computed from a body or a rule that has changed since is not a
   * verification of the current content, so the commit is rejected and the row
   * keeps `needs_recheck`. Only `event: 'check'` consults them.
   */
  expectedRevisions?: {
    documentUpdatedAt?: Date | null;
    ruleUpdatedAt?: Date | null;
  };
  explanation?: string | null;
  outcome?: DocumentReviewCheckOutcome;
  /** Only meaningful for `apply_suggestion`: the (possibly user-edited) fix applied. */
  suggestion?: DocumentReviewCheckSuggestion | null;
}

/**
 * Persistence for document review sessions, impact items, rule sets and check
 * results.
 *
 * Authorization against the parent document happens in the router; this model
 * only guarantees workspace isolation (every read and write carries the
 * caller's workspace in its WHERE clause) and the check-status invariants.
 */
export class DocumentReviewModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string | null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private scoped = (db: LobeChatDatabase) =>
    new DocumentReviewModel(db, this.userId, this.workspaceId);

  private requireWorkspaceId = (): string => {
    if (!this.workspaceId) throw new Error(DOCUMENT_REVIEW_WORKSPACE_REQUIRED);
    return this.workspaceId;
  };

  private assertDocument = async (db: LobeChatDatabase, documentId: string) => {
    const workspaceId = this.requireWorkspaceId();
    const [document] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.workspaceId, workspaceId),
          notTrashed(documents.isDeleted),
        ),
      )
      .limit(1);
    if (!document) throw new Error(DOCUMENT_REVIEW_DOCUMENT_NOT_FOUND);
    return workspaceId;
  };

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  createSession = async (params: {
    baseHistoryId?: string | null;
    documentId: string;
    ruleSetId?: string | null;
    title?: string | null;
  }): Promise<DocumentReviewSessionItem> => {
    return this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const workspaceId = await this.assertDocument(tx, params.documentId);
      if (params.ruleSetId)
        await this.assertRuleSetOfDocument(tx, params.ruleSetId, params.documentId);

      const [session] = await tx
        .insert(documentReviewSessions)
        .values({
          baseHistoryId: params.baseHistoryId ?? null,
          documentId: params.documentId,
          ruleSetId: params.ruleSetId ?? null,
          title: params.title ?? null,
          userId: this.userId,
          workspaceId,
        })
        .returning();
      return session;
    });
  };

  findSessionById = async (id: string): Promise<DocumentReviewSessionItem | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    const [session] = await this.db
      .select()
      .from(documentReviewSessions)
      .where(
        and(eq(documentReviewSessions.id, id), eq(documentReviewSessions.workspaceId, workspaceId)),
      )
      .limit(1);
    return session;
  };

  listSessions = async (documentId: string): Promise<DocumentReviewSessionItem[]> => {
    const workspaceId = this.requireWorkspaceId();
    return this.db
      .select()
      .from(documentReviewSessions)
      .where(
        and(
          eq(documentReviewSessions.documentId, documentId),
          eq(documentReviewSessions.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(documentReviewSessions.createdAt), desc(documentReviewSessions.id));
  };

  updateSession = async (
    id: string,
    value: {
      baseHistoryId?: string | null;
      ruleSetId?: string | null;
      status?: DocumentReviewSessionStatus;
      title?: string | null;
    },
  ): Promise<DocumentReviewSessionItem | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    return this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const current = await this.scoped(tx).findSessionById(id);
      if (!current) return undefined;
      if (value.ruleSetId)
        await this.assertRuleSetOfDocument(tx, value.ruleSetId, current.documentId);

      const [session] = await tx
        .update(documentReviewSessions)
        .set(value)
        .where(
          and(
            eq(documentReviewSessions.id, id),
            eq(documentReviewSessions.workspaceId, workspaceId),
          ),
        )
        .returning();

      // A different rule set makes every existing check result meaningless.
      if (value.ruleSetId !== undefined && value.ruleSetId !== current.ruleSetId) {
        await tx
          .delete(documentReviewCheckResults)
          .where(
            and(
              eq(documentReviewCheckResults.sessionId, id),
              eq(documentReviewCheckResults.workspaceId, workspaceId),
            ),
          );
      }
      return session;
    });
  };

  deleteSession = async (id: string): Promise<boolean> => {
    const workspaceId = this.requireWorkspaceId();
    const rows = await this.db
      .delete(documentReviewSessions)
      .where(
        and(eq(documentReviewSessions.id, id), eq(documentReviewSessions.workspaceId, workspaceId)),
      )
      .returning({ id: documentReviewSessions.id });
    return rows.length > 0;
  };

  // ---------------------------------------------------------------------------
  // Impact items
  // ---------------------------------------------------------------------------

  /** Replace a session's impact list with a fresh analysis result. */
  replaceImpacts = async (
    sessionId: string,
    items: DocumentReviewImpactInput[],
  ): Promise<DocumentReviewImpactItem[]> => {
    const workspaceId = this.requireWorkspaceId();
    return this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const session = await this.scoped(tx).findSessionById(sessionId);
      if (!session) throw new Error(DOCUMENT_REVIEW_NOT_FOUND);

      await tx
        .delete(documentReviewImpacts)
        .where(
          and(
            eq(documentReviewImpacts.sessionId, sessionId),
            eq(documentReviewImpacts.workspaceId, workspaceId),
          ),
        );
      if (items.length === 0) return [];

      return tx
        .insert(documentReviewImpacts)
        .values(
          items.map((item, index) => ({
            category: item.category,
            confidence: item.confidence ?? null,
            kind: item.kind,
            reason: item.reason,
            relatedAnchor: item.relatedAnchor ?? null,
            sessionId,
            severity: item.severity ?? 'medium',
            sortOrder: index,
            sourceAnchor: item.sourceAnchor ?? null,
            title: item.title,
            trigger: item.trigger ?? null,
            workspaceId,
          })),
        )
        .returning();
    });
  };

  listImpacts = async (sessionId: string): Promise<DocumentReviewImpactItem[]> => {
    const workspaceId = this.requireWorkspaceId();
    return this.db
      .select()
      .from(documentReviewImpacts)
      .where(
        and(
          eq(documentReviewImpacts.sessionId, sessionId),
          eq(documentReviewImpacts.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(documentReviewImpacts.sortOrder), asc(documentReviewImpacts.id));
  };

  findImpactById = async (id: string): Promise<DocumentReviewImpactItem | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    const [impact] = await this.db
      .select()
      .from(documentReviewImpacts)
      .where(
        and(eq(documentReviewImpacts.id, id), eq(documentReviewImpacts.workspaceId, workspaceId)),
      )
      .limit(1);
    return impact;
  };

  updateImpactStatus = async (
    id: string,
    status: DocumentReviewImpactStatus,
  ): Promise<DocumentReviewImpactItem | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    const [impact] = await this.db
      .update(documentReviewImpacts)
      .set({ status })
      .where(
        and(eq(documentReviewImpacts.id, id), eq(documentReviewImpacts.workspaceId, workspaceId)),
      )
      .returning();
    return impact;
  };

  // ---------------------------------------------------------------------------
  // Rule sets & rules
  // ---------------------------------------------------------------------------

  private assertRuleSetOfDocument = async (
    db: LobeChatDatabase,
    ruleSetId: string,
    documentId: string,
  ) => {
    const workspaceId = this.requireWorkspaceId();
    const [ruleSet] = await db
      .select({ documentId: documentReviewRuleSets.documentId })
      .from(documentReviewRuleSets)
      .where(
        and(
          eq(documentReviewRuleSets.id, ruleSetId),
          eq(documentReviewRuleSets.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!ruleSet) throw new Error(DOCUMENT_REVIEW_NOT_FOUND);
    if (ruleSet.documentId !== documentId) throw new Error(DOCUMENT_REVIEW_RULE_SET_MISMATCH);
  };

  createRuleSet = async (params: {
    description?: string | null;
    documentId: string;
    rules?: DocumentReviewRuleInput[];
    title: string;
  }): Promise<DocumentReviewRuleSetWithRules> => {
    return this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const workspaceId = await this.assertDocument(tx, params.documentId);
      const [ruleSet] = await tx
        .insert(documentReviewRuleSets)
        .values({
          description: params.description ?? null,
          documentId: params.documentId,
          title: params.title,
          userId: this.userId,
          workspaceId,
        })
        .returning();

      const rules = params.rules?.length
        ? await tx
            .insert(documentReviewRules)
            .values(
              params.rules.map((rule, index) => ({
                instruction: rule.instruction,
                ruleSetId: ruleSet.id,
                severity: rule.severity ?? 'medium',
                sortOrder: index,
                title: rule.title,
                workspaceId,
              })),
            )
            .returning()
        : [];
      return { ...ruleSet, rules };
    });
  };

  findRuleSetById = async (id: string): Promise<DocumentReviewRuleSetWithRules | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    const [ruleSet] = await this.db
      .select()
      .from(documentReviewRuleSets)
      .where(
        and(eq(documentReviewRuleSets.id, id), eq(documentReviewRuleSets.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!ruleSet) return undefined;
    return { ...ruleSet, rules: await this.listRules(id) };
  };

  listRuleSets = async (documentId: string): Promise<DocumentReviewRuleSetItem[]> => {
    const workspaceId = this.requireWorkspaceId();
    return this.db
      .select()
      .from(documentReviewRuleSets)
      .where(
        and(
          eq(documentReviewRuleSets.documentId, documentId),
          eq(documentReviewRuleSets.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(documentReviewRuleSets.createdAt), desc(documentReviewRuleSets.id));
  };

  listRules = async (ruleSetId: string): Promise<DocumentReviewRuleItem[]> => {
    const workspaceId = this.requireWorkspaceId();
    return this.db
      .select()
      .from(documentReviewRules)
      .where(
        and(
          eq(documentReviewRules.ruleSetId, ruleSetId),
          eq(documentReviewRules.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(documentReviewRules.sortOrder), asc(documentReviewRules.id));
  };

  findRuleById = async (id: string): Promise<DocumentReviewRuleItem | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    const [rule] = await this.db
      .select()
      .from(documentReviewRules)
      .where(and(eq(documentReviewRules.id, id), eq(documentReviewRules.workspaceId, workspaceId)))
      .limit(1);
    return rule;
  };

  /** Any edit returns a confirmed set to `draft`; the user must confirm it again. */
  private markRuleSetDraft = async (db: LobeChatDatabase, ruleSetId: string) => {
    const workspaceId = this.requireWorkspaceId();
    await db
      .update(documentReviewRuleSets)
      .set({ confirmedAt: null, confirmedByUserId: null, status: 'draft' })
      .where(
        and(
          eq(documentReviewRuleSets.id, ruleSetId),
          eq(documentReviewRuleSets.workspaceId, workspaceId),
        ),
      );
  };

  updateRuleSet = async (
    id: string,
    value: { description?: string | null; title?: string },
  ): Promise<DocumentReviewRuleSetItem | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    const [ruleSet] = await this.db
      .update(documentReviewRuleSets)
      .set(value)
      .where(
        and(eq(documentReviewRuleSets.id, id), eq(documentReviewRuleSets.workspaceId, workspaceId)),
      )
      .returning();
    return ruleSet;
  };

  deleteRuleSet = async (id: string): Promise<boolean> => {
    const workspaceId = this.requireWorkspaceId();
    const rows = await this.db
      .delete(documentReviewRuleSets)
      .where(
        and(eq(documentReviewRuleSets.id, id), eq(documentReviewRuleSets.workspaceId, workspaceId)),
      )
      .returning({ id: documentReviewRuleSets.id });
    return rows.length > 0;
  };

  addRule = async (ruleSetId: string, rule: DocumentReviewRuleInput) => {
    const workspaceId = this.requireWorkspaceId();
    return this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const existing = await this.scoped(tx).listRules(ruleSetId);
      const [ruleSet] = await tx
        .select({ id: documentReviewRuleSets.id })
        .from(documentReviewRuleSets)
        .where(
          and(
            eq(documentReviewRuleSets.id, ruleSetId),
            eq(documentReviewRuleSets.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!ruleSet) throw new Error(DOCUMENT_REVIEW_NOT_FOUND);

      const [created] = await tx
        .insert(documentReviewRules)
        .values({
          instruction: rule.instruction,
          ruleSetId,
          severity: rule.severity ?? 'medium',
          sortOrder: existing.length,
          title: rule.title,
          workspaceId,
        })
        .returning();
      await this.markRuleSetDraft(tx, ruleSetId);
      return created;
    });
  };

  /**
   * Edit a rule. Its existing check results no longer describe the rule as
   * written, so every checked result for it becomes `needs_recheck`.
   */
  updateRule = async (
    id: string,
    value: Partial<DocumentReviewRuleInput>,
  ): Promise<DocumentReviewRuleItem | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    return this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const [rule] = await tx
        .update(documentReviewRules)
        .set(value)
        .where(
          and(eq(documentReviewRules.id, id), eq(documentReviewRules.workspaceId, workspaceId)),
        )
        .returning();
      if (!rule) return undefined;

      await this.markRuleSetDraft(tx, rule.ruleSetId);
      await tx
        .update(documentReviewCheckResults)
        .set({ status: 'needs_recheck' })
        .where(
          and(
            eq(documentReviewCheckResults.ruleId, id),
            eq(documentReviewCheckResults.workspaceId, workspaceId),
            ne(documentReviewCheckResults.status, 'unchecked'),
          ),
        );
      return rule;
    });
  };

  removeRule = async (id: string): Promise<boolean> => {
    const workspaceId = this.requireWorkspaceId();
    return this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const [rule] = await tx
        .delete(documentReviewRules)
        .where(
          and(eq(documentReviewRules.id, id), eq(documentReviewRules.workspaceId, workspaceId)),
        )
        .returning({ ruleSetId: documentReviewRules.ruleSetId });
      if (!rule) return false;
      await this.markRuleSetDraft(tx, rule.ruleSetId);
      return true;
    });
  };

  /** The user accepts the rule set as the playbook to check against. */
  confirmRuleSet = async (id: string): Promise<DocumentReviewRuleSetWithRules | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    const rules = await this.listRules(id);
    const current = await this.findRuleSetById(id);
    if (!current) return undefined;
    if (rules.length === 0) throw new Error(DOCUMENT_REVIEW_RULE_SET_EMPTY);

    const [ruleSet] = await this.db
      .update(documentReviewRuleSets)
      .set({ confirmedAt: new Date(), confirmedByUserId: this.userId, status: 'confirmed' })
      .where(
        and(eq(documentReviewRuleSets.id, id), eq(documentReviewRuleSets.workspaceId, workspaceId)),
      )
      .returning();
    return { ...ruleSet, rules };
  };

  // ---------------------------------------------------------------------------
  // Check results
  // ---------------------------------------------------------------------------

  /**
   * Materialize one `unchecked` result per rule of the session's confirmed rule
   * set. Idempotent: existing results keep their status.
   */
  initializeChecks = async (sessionId: string): Promise<DocumentReviewCheckResultItem[]> => {
    const workspaceId = this.requireWorkspaceId();
    const session = await this.findSessionById(sessionId);
    if (!session?.ruleSetId) throw new Error(DOCUMENT_REVIEW_NOT_FOUND);
    const ruleSet = await this.findRuleSetById(session.ruleSetId);
    if (!ruleSet) throw new Error(DOCUMENT_REVIEW_NOT_FOUND);
    if (ruleSet.status !== 'confirmed') throw new Error(DOCUMENT_REVIEW_RULE_SET_NOT_CONFIRMED);

    if (ruleSet.rules.length > 0) {
      await this.db
        .insert(documentReviewCheckResults)
        .values(ruleSet.rules.map((rule) => ({ ruleId: rule.id, sessionId, workspaceId })))
        .onConflictDoNothing({
          target: [documentReviewCheckResults.sessionId, documentReviewCheckResults.ruleId],
        });
    }
    return this.listCheckResults(sessionId);
  };

  listCheckResults = async (sessionId: string): Promise<DocumentReviewCheckResultItem[]> => {
    const workspaceId = this.requireWorkspaceId();
    return this.db
      .select({ result: documentReviewCheckResults })
      .from(documentReviewCheckResults)
      .innerJoin(documentReviewRules, eq(documentReviewRules.id, documentReviewCheckResults.ruleId))
      .where(
        and(
          eq(documentReviewCheckResults.sessionId, sessionId),
          eq(documentReviewCheckResults.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(documentReviewRules.sortOrder), asc(documentReviewRules.id))
      .then((rows) => rows.map(({ result }) => result));
  };

  findCheckResultById = async (id: string): Promise<DocumentReviewCheckResultItem | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    const [result] = await this.db
      .select()
      .from(documentReviewCheckResults)
      .where(
        and(
          eq(documentReviewCheckResults.id, id),
          eq(documentReviewCheckResults.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return result;
  };

  /**
   * Edit the suggested fix before applying it. Never touches `status`: an
   * edited suggestion is not a verification.
   */
  updateSuggestion = async (
    id: string,
    suggestion: DocumentReviewCheckSuggestion | null,
  ): Promise<DocumentReviewCheckResultItem | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    const [result] = await this.db
      .update(documentReviewCheckResults)
      .set({ suggestion })
      .where(
        and(
          eq(documentReviewCheckResults.id, id),
          eq(documentReviewCheckResults.workspaceId, workspaceId),
        ),
      )
      .returning();
    return result;
  };

  /**
   * True when the document body or the rule changed after `expected` was
   * captured. A missing row counts as stale: the thing the verdict describes is
   * gone, so the verdict cannot be committed either.
   */
  private isVerdictStale = async (
    db: LobeChatDatabase,
    current: DocumentReviewCheckResultItem,
    expected: NonNullable<TransitionCheckParams['expectedRevisions']>,
  ): Promise<boolean> => {
    const workspaceId = this.requireWorkspaceId();

    if (expected.documentUpdatedAt !== undefined) {
      const [session] = await db
        .select({ documentId: documentReviewSessions.documentId })
        .from(documentReviewSessions)
        .where(
          and(
            eq(documentReviewSessions.id, current.sessionId),
            eq(documentReviewSessions.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      const [document] = session
        ? await db
            .select({ updatedAt: documents.updatedAt })
            .from(documents)
            .where(
              and(eq(documents.id, session.documentId), eq(documents.workspaceId, workspaceId)),
            )
            .limit(1)
        : [];
      if (!document || !sameRevision(document.updatedAt, expected.documentUpdatedAt)) return true;
    }

    if (expected.ruleUpdatedAt !== undefined) {
      const [rule] = await db
        .select({ updatedAt: documentReviewRules.updatedAt })
        .from(documentReviewRules)
        .where(
          and(
            eq(documentReviewRules.id, current.ruleId),
            eq(documentReviewRules.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!rule || !sameRevision(rule.updatedAt, expected.ruleUpdatedAt)) return true;
    }

    return false;
  };

  /**
   * The only write path for `status`. Locks the row, derives the next status
   * through `resolveDocumentReviewCheckTransition` (which throws
   * `DocumentReviewTransitionError` on an illegal move such as apply → passed),
   * then persists it.
   */
  transitionCheck = async (
    id: string,
    params: TransitionCheckParams,
  ): Promise<DocumentReviewCheckResultItem | undefined> => {
    const workspaceId = this.requireWorkspaceId();
    return this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const [current] = await tx
        .select()
        .from(documentReviewCheckResults)
        .where(
          and(
            eq(documentReviewCheckResults.id, id),
            eq(documentReviewCheckResults.workspaceId, workspaceId),
          ),
        )
        .limit(1)
        .for('update');
      if (!current) return undefined;

      // A verdict computed from a body or a rule that moved during the LLM call
      // is not a verification of what the document says now. Re-read both
      // revisions inside this locked transaction: a concurrent autosave or rule
      // edit either committed already (caught here) or blocks until we commit.
      // Either way the row must not become `passed` on stale content.
      if (params.event === 'check' && params.expectedRevisions) {
        const stale = await this.isVerdictStale(
          tx as unknown as LobeChatDatabase,
          current,
          params.expectedRevisions,
        );
        if (stale) {
          const [result] = await tx
            .update(documentReviewCheckResults)
            .set({
              status: resolveDocumentReviewCheckTransition(current.status, { event: 'invalidate' }),
            })
            .where(
              and(
                eq(documentReviewCheckResults.id, id),
                eq(documentReviewCheckResults.workspaceId, workspaceId),
              ),
            )
            .returning();
          return result;
        }
      }

      const status = resolveDocumentReviewCheckTransition(current.status, {
        event: params.event,
        outcome: params.outcome,
      });

      const now = new Date();
      const patch: Partial<DocumentReviewCheckResultItem> = { status };
      switch (params.event) {
        case 'check': {
          patch.checkedAt = now;
          if (params.explanation !== undefined) patch.explanation = params.explanation;
          if (params.evidence !== undefined) patch.evidence = params.evidence;
          // A fresh verdict invalidates the previous fix. Either an applied
          // suggestion already consumed its target, or an ordinary edit moved
          // the text, so re-offering `current.suggestion` would surface a fix
          // whose Apply returns ANCHOR_LOST. A caller that computed a new fix
          // passes it explicitly; otherwise the row keeps no suggestion.
          patch.suggestion = status === 'passed' ? null : (params.suggestion ?? null);
          break;
        }
        case 'apply_suggestion': {
          patch.appliedAt = now;
          if (params.suggestion !== undefined) patch.suggestion = params.suggestion;
          break;
        }
        case 'reset': {
          Object.assign(patch, {
            appliedAt: null,
            checkedAt: null,
            evidence: null,
            explanation: null,
            suggestion: null,
          });
          break;
        }
        // `invalidate` only changes the status.
      }

      // Keep the workspace predicate on the write itself: the locked read above is
      // scoped, but a concurrent `rehomeDocumentReviews` could still move the row
      // between the select and this update.
      const [result] = await tx
        .update(documentReviewCheckResults)
        .set(patch)
        .where(
          and(
            eq(documentReviewCheckResults.id, id),
            eq(documentReviewCheckResults.workspaceId, workspaceId),
          ),
        )
        .returning();
      return result;
    });
  };

  /**
   * The document body changed: every checked result in the document's active
   * sessions is stale. Returns the number of results moved to `needs_recheck`.
   */
  invalidateDocumentChecks = async (documentId: string): Promise<number> => {
    const workspaceId = this.requireWorkspaceId();
    const rows = await this.db
      .update(documentReviewCheckResults)
      .set({ status: 'needs_recheck' })
      .where(
        and(
          eq(documentReviewCheckResults.workspaceId, workspaceId),
          ne(documentReviewCheckResults.status, 'unchecked'),
          ne(documentReviewCheckResults.status, 'needs_recheck'),
          inArray(
            documentReviewCheckResults.sessionId,
            this.db
              .select({ id: documentReviewSessions.id })
              .from(documentReviewSessions)
              .where(
                and(
                  eq(documentReviewSessions.documentId, documentId),
                  eq(documentReviewSessions.workspaceId, workspaceId),
                  eq(documentReviewSessions.status, 'active'),
                ),
              ),
          ),
        ),
      )
      .returning({ id: documentReviewCheckResults.id });
    return rows.length;
  };
}

// -----------------------------------------------------------------------------
// Document transfer helpers (used by DocumentModel.transfer)
// -----------------------------------------------------------------------------

const sessionIdsOf = (db: LobeChatDatabase, documentIds: string[]) =>
  db
    .select({ id: documentReviewSessions.id })
    .from(documentReviewSessions)
    .where(inArray(documentReviewSessions.documentId, documentIds));

const ruleSetIdsOf = (db: LobeChatDatabase, documentIds: string[]) =>
  db
    .select({ id: documentReviewRuleSets.id })
    .from(documentReviewRuleSets)
    .where(inArray(documentReviewRuleSets.documentId, documentIds));

/** Review rows created by someone else block a non-owner document transfer. */
export const hasForeignDocumentReviews = async (
  db: LobeChatDatabase,
  documentIds: string[],
  userId: string,
): Promise<boolean> => {
  if (documentIds.length === 0) return false;
  const [session] = await db
    .select({ id: documentReviewSessions.id })
    .from(documentReviewSessions)
    .where(
      and(
        inArray(documentReviewSessions.documentId, documentIds),
        or(ne(documentReviewSessions.userId, userId), isNull(documentReviewSessions.userId)),
      ),
    )
    .limit(1);
  if (session) return true;

  const [ruleSet] = await db
    .select({ id: documentReviewRuleSets.id })
    .from(documentReviewRuleSets)
    .where(
      and(
        inArray(documentReviewRuleSets.documentId, documentIds),
        or(ne(documentReviewRuleSets.userId, userId), isNull(documentReviewRuleSets.userId)),
      ),
    )
    .limit(1);
  return Boolean(ruleSet);
};

/** Move every review row of the transferred documents into the target workspace. */
export const rehomeDocumentReviews = async (
  db: LobeChatDatabase,
  documentIds: string[],
  workspaceId: string,
) => {
  if (documentIds.length === 0) return;
  await db
    .update(documentReviewSessions)
    .set({ updatedAt: documentReviewSessions.updatedAt, workspaceId })
    .where(inArray(documentReviewSessions.documentId, documentIds));
  await db
    .update(documentReviewImpacts)
    .set({ updatedAt: documentReviewImpacts.updatedAt, workspaceId })
    .where(inArray(documentReviewImpacts.sessionId, sessionIdsOf(db, documentIds)));
  await db
    .update(documentReviewCheckResults)
    .set({ updatedAt: documentReviewCheckResults.updatedAt, workspaceId })
    .where(inArray(documentReviewCheckResults.sessionId, sessionIdsOf(db, documentIds)));
  await db
    .update(documentReviewRuleSets)
    .set({ updatedAt: documentReviewRuleSets.updatedAt, workspaceId })
    .where(inArray(documentReviewRuleSets.documentId, documentIds));
  await db
    .update(documentReviewRules)
    .set({ updatedAt: documentReviewRules.updatedAt, workspaceId })
    .where(inArray(documentReviewRules.ruleSetId, ruleSetIdsOf(db, documentIds)));
};

/** Reviews cannot follow a document into personal scope; children cascade. */
export const deleteDocumentReviews = async (db: LobeChatDatabase, documentIds: string[]) => {
  if (documentIds.length === 0) return;
  await db
    .delete(documentReviewSessions)
    .where(inArray(documentReviewSessions.documentId, documentIds));
  await db
    .delete(documentReviewRuleSets)
    .where(inArray(documentReviewRuleSets.documentId, documentIds));
};

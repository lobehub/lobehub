import type { DocumentReviewCheckStatus } from '@lobechat/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { usePermission } from '@/hooks/usePermission';
import { mutate as mutateSWR, useClientDataSWR } from '@/libs/swr';
import { documentReviewKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { invalidateDocumentMutation } from '@/services/document/invalidation';
import type {
  DocumentReviewRuleSetItem,
  DocumentReviewRuleSetWithRules,
  DocumentReviewSessionDetail,
  DocumentReviewSessionItem,
  ProposedRuleDraft,
  ProposeRulesResult,
} from '@/services/documentReview';
import { documentReviewService } from '@/services/documentReview';

import { usePageEditorStore } from '../store';
import type { ReviewAction, ReviewActionError } from './types';
import { classifyReviewError } from './utils';

const NO_EARLIER_VERSION = 'NO_EARLIER_VERSION';

class ReviewClientError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'ReviewClientError';
  }
}

const toActionError = (action: ReviewAction, error: unknown): ReviewActionError => {
  if (error instanceof ReviewClientError) {
    const type = error.code === NO_EARLIER_VERSION ? 'noBaseline' : 'generic';
    return { action, type };
  }
  return { action, type: classifyReviewError(error) };
};

export interface UseDocumentReviewOptions {
  documentId?: string;
}

/**
 * Data + actions behind the review panel.
 *
 * Reads follow the app's data-fetching split: `useClientDataSWR` owns the
 * request state (loading / error / retry), the component renders from it, and
 * every write goes through `documentReviewService` and then revalidates the
 * same keys. The panel keeps only what the server cannot: which session is
 * being looked at, the last action's pending/error state, and the status an
 * applied fix already produced before the refetch lands.
 */
export const useDocumentReview = ({ documentId }: UseDocumentReviewOptions) => {
  const { t } = useTranslation('file');
  const workspaceId = useActiveWorkspaceId();
  const isWorkspaceScopedPage = usePageEditorStore((s) => s.isWorkspaceScopedPage);
  const { allowed: canWrite } = usePermission('edit_own_content');
  const hasWorkspace = Boolean(workspaceId) && isWorkspaceScopedPage;

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ReviewAction | null>(null);
  const [actionError, setActionError] = useState<ReviewActionError | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, DocumentReviewCheckStatus>>(
    {},
  );
  const [proposals, setProposals] = useState<ProposedRuleDraft[] | null>(null);
  const retryRef = useRef<null | (() => Promise<void>)>(null);

  const sessionsSWR = useClientDataSWR<DocumentReviewSessionItem[]>(
    hasWorkspace && documentId ? documentReviewKeys.sessions(documentId) : null,
    () => documentReviewService.listSessions(documentId!),
  );

  const ruleSetsSWR = useClientDataSWR<DocumentReviewRuleSetItem[]>(
    hasWorkspace && documentId ? documentReviewKeys.ruleSets(documentId) : null,
    () => documentReviewService.listRuleSets(documentId!),
  );

  const activeSessionId = selectedSessionId ?? sessionsSWR.data?.[0]?.id ?? null;

  const detailSWR = useClientDataSWR<DocumentReviewSessionDetail>(
    hasWorkspace && activeSessionId ? documentReviewKeys.sessionDetail(activeSessionId) : null,
    () => documentReviewService.getSession(activeSessionId!),
  );

  const detail = detailSWR.data;
  const session = detail?.session ?? sessionsSWR.data?.find((item) => item.id === activeSessionId);
  const ruleSet: DocumentReviewRuleSetWithRules | null = detail?.ruleSet ?? null;

  // A different session is a different checklist: overrides fixed to the old
  // rows would otherwise paint a status that belongs to another review.
  useEffect(() => {
    setStatusOverrides({});
    setActionError(null);
    setProposals(null);
  }, [activeSessionId]);

  // The panel outlives a document switch inside page mode (query/history
  // navigation keeps it mounted). A selection carried over from the previous
  // document would win over this document's own session list, and actions such
  // as analyze or apply would then mutate the document that is no longer shown.
  useEffect(() => {
    setSelectedSessionId(null);
  }, [documentId]);

  const refreshDetail = async (sessionId = activeSessionId) => {
    if (!sessionId) return;
    await mutateSWR(documentReviewKeys.sessionDetail(sessionId));
  };

  const refreshSessions = async () => {
    await sessionsSWR.mutate();
  };

  const refreshRuleSets = async () => {
    await ruleSetsSWR.mutate();
  };

  const runAction = async (action: ReviewAction, work: () => Promise<void>) => {
    retryRef.current = () => runAction(action, work);
    setPendingAction(action);
    setActionError(null);
    try {
      await work();
      retryRef.current = null;
    } catch (error) {
      console.error(`[DocumentReview] ${action} failed:`, error);
      setActionError(toActionError(action, error));
    } finally {
      setPendingAction(null);
    }
  };

  /**
   * A review compares the current body with an earlier saved revision. The
   * session stores that baseline; the first run picks the newest earlier
   * history item so the reader does not have to.
   */
  const resolveBaselineHistoryId = async (): Promise<string> => {
    const history = await documentService.listDocumentHistory({
      documentId: documentId!,
      includeCurrent: true,
      limit: 20,
    });
    const baseline = history.items.find((item) => !item.isCurrent);
    if (!baseline) throw new ReviewClientError(NO_EARLIER_VERSION);
    return baseline.id;
  };

  const startReview = async () => {
    if (!documentId || !canWrite) return;
    await runAction('analyze', async () => {
      const baseHistoryId = await resolveBaselineHistoryId();
      const created = await documentReviewService.createSession({ baseHistoryId, documentId });
      setSelectedSessionId(created.id);
      await documentReviewService.analyzeImpacts({ baseHistoryId, sessionId: created.id });
      await refreshSessions();
      await refreshDetail(created.id);
    });
  };

  const analyze = async () => {
    if (!documentId || !canWrite) return;
    if (!activeSessionId) {
      await startReview();
      return;
    }
    await runAction('analyze', async () => {
      await documentReviewService.analyzeImpacts({ sessionId: activeSessionId });
      await refreshSessions();
      await refreshDetail(activeSessionId);
    });
  };

  const selectRuleSet = async (ruleSetId: string) => {
    if (!activeSessionId || !canWrite) return;
    if (session?.ruleSetId === ruleSetId) return;
    await runAction('confirmRuleSet', async () => {
      await documentReviewService.updateSession({ ruleSetId, sessionId: activeSessionId });
      await refreshDetail();
    });
  };

  const confirmRuleSet = async (ruleSetId?: string) => {
    const targetId = ruleSetId ?? ruleSet?.id;
    if (!activeSessionId || !targetId || !canWrite) return;
    await runAction('confirmRuleSet', async () => {
      await documentReviewService.confirmRuleSet(targetId);
      await documentReviewService.updateSession({
        ruleSetId: targetId,
        sessionId: activeSessionId,
      });
      await refreshRuleSets();
      await refreshDetail();
    });
  };

  const runChecks = async (checkResultIds?: string[]) => {
    if (!activeSessionId || !canWrite) return;
    const targetRuleSetId = ruleSet?.id;
    if (!targetRuleSetId) return;

    await runAction('runChecks', async () => {
      if (session?.ruleSetId !== targetRuleSetId) {
        await documentReviewService.updateSession({
          ruleSetId: targetRuleSetId,
          sessionId: activeSessionId,
        });
      }
      // Rules can be added to an already-checked set, and the server only
      // evaluates persisted result rows. Initialising before every run (it is
      // idempotent through `onConflictDoNothing`) backfills those new rules
      // instead of leaving them permanently unchecked.
      await documentReviewService.initializeChecks(activeSessionId);
      await documentReviewService.runChecks({ checkResultIds, sessionId: activeSessionId });
      await refreshDetail();
    });
  };

  const recheck = async (checkResultIds?: string[]) => {
    if (!activeSessionId || !canWrite) return;
    await runAction('recheck', async () => {
      const rechecked = await documentReviewService.recheckChecks({
        checkResultIds,
        sessionId: activeSessionId,
      });
      // The optimistic `needs_recheck` paint only covers the gap between
      // applying a fix and the re-check returning. Once the server has a new
      // verdict, drop the override so the row shows that verdict instead of
      // staying "needs re-check" forever.
      setStatusOverrides((current) => {
        const next = { ...current };
        for (const item of rechecked) delete next[item.id];
        return next;
      });
      await refreshDetail();
    });
  };

  const suggestFix = async (checkResultId: string) => {
    if (!activeSessionId || !canWrite) return;
    await runAction('suggestFix', async () => {
      await documentReviewService.suggestFix({ checkResultId });
      await refreshDetail();
    });
  };

  const applySuggestion = async (checkResultId: string, appliedText: string) => {
    if (!activeSessionId || !canWrite) return;
    await runAction('applySuggestion', async () => {
      const applied = await documentReviewService.applySuggestion({
        appliedText,
        checkResultId,
      });
      // Applying a fix only ever lands on `needs_recheck` (the server owns that
      // invariant); paint it immediately, before the refetch settles.
      setStatusOverrides((current) => ({ ...current, [applied.id]: applied.status }));
      // The server rewrote the body, but this window made the write itself, so
      // the resource event stream skips it as a same-user echo. Refresh the
      // replica here or the editor keeps showing the pre-fix text — and the
      // next autosave would then conflict with, and roll back, the applied fix.
      if (documentId) {
        try {
          await invalidateDocumentMutation({ cause: 'document-service', documentId });
        } catch (error) {
          console.error('[DocumentReview] refresh after applying a fix failed:', error);
        }
      }
      await refreshDetail();
    });
  };

  const proposeRules = async (description?: string) => {
    if (!documentId || !canWrite) return;
    await runAction('proposeRules', async () => {
      const result: ProposeRulesResult = await documentReviewService.proposeRules({
        description,
        documentId,
      });
      setProposals(result.drafts);
    });
  };

  const discardProposals = () => setProposals(null);

  const adoptRules = async (selected: ProposedRuleDraft[]) => {
    if (!documentId || !activeSessionId || !canWrite || selected.length === 0) return;
    await runAction('adoptRules', async () => {
      const created = await documentReviewService.createRuleSet({
        documentId,
        rules: selected.map((draft) => ({
          instruction: draft.instruction,
          severity: draft.severity,
          title: draft.title,
        })),
        title: t('pageEditor.review.rules.agentSuggested'),
      });
      await documentReviewService.confirmRuleSet(created.id);
      await documentReviewService.updateSession({
        ruleSetId: created.id,
        sessionId: activeSessionId,
      });
      setProposals(null);
      await refreshRuleSets();
      await refreshDetail();
    });
  };

  const retryLastAction = async () => {
    await retryRef.current?.();
  };

  const checkResults = useMemo(() => detail?.checkResults ?? [], [detail?.checkResults]);
  const impacts = useMemo(() => detail?.impacts ?? [], [detail?.impacts]);

  return {
    actionError,
    activeSessionId,
    adoptRules,
    analyze,
    applySuggestion,
    canWrite,
    checkResults,
    clearActionError: () => setActionError(null),
    confirmRuleSet,
    detail,
    detailLoading: Boolean(activeSessionId) && detailSWR.isLoading && !detailSWR.data,
    discardProposals,
    error: sessionsSWR.error ?? detailSWR.error,
    hasWorkspace,
    impacts,
    isLoading:
      sessionsSWR.isLoading || (Boolean(activeSessionId) && detailSWR.isLoading && !detailSWR.data),
    pendingAction,
    proposeRules,
    proposals,
    recheck,
    retry: () => {
      if (detailSWR.error) void detailSWR.mutate();
      if (sessionsSWR.error) void sessionsSWR.mutate();
    },
    retryLastAction,
    ruleSet,
    ruleSets: ruleSetsSWR.data ?? [],
    ruleSetsError: ruleSetsSWR.error,
    runChecks,
    selectRuleSet,
    selectSession: (sessionId: string) => setSelectedSessionId(sessionId),
    session,
    sessions: sessionsSWR.data ?? [],
    sessionsLoading: sessionsSWR.isLoading,
    suggestFix,
    statusOverrides,
  };
};

export type DocumentReviewController = ReturnType<typeof useDocumentReview>;
export type {
  DocumentReviewCheckResultItem,
  DocumentReviewImpactItem,
  DocumentReviewRuleItem,
} from '@/services/documentReview';

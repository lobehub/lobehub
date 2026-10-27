/**
 * @vitest-environment happy-dom
 */
import type { DocumentReviewCheckStatus } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DocumentReviewCheckResultItem,
  DocumentReviewSessionDetail,
  DocumentReviewSessionItem,
} from '@/services/documentReview';

import { useDocumentReview } from './useDocumentReview';
import { resolveCheckStatus } from './utils';

const mocks = vi.hoisted(() => ({
  analyzeImpacts: vi.fn(),
  applySuggestion: vi.fn(),
  confirmRuleSet: vi.fn(),
  createRuleSet: vi.fn(),
  createSession: vi.fn(),
  getImpactFollowUpContext: vi.fn(),
  getSession: vi.fn(),
  initializeChecks: vi.fn(),
  invalidateDocumentMutation: vi.fn(),
  listDocumentHistory: vi.fn(),
  listRuleSets: vi.fn(),
  listSessions: vi.fn(),
  proposeRules: vi.fn(),
  recheckChecks: vi.fn(),
  runChecks: vi.fn(),
  suggestFix: vi.fn(),
  updateSession: vi.fn(),
}));

const swrState = vi.hoisted(() => ({ cache: new Map<string, unknown>() }));

vi.mock('@/libs/swr', async () => {
  const React = await import('react');

  return {
    mutate: vi.fn(),
    useClientDataSWR: (key: unknown, fetcher: () => Promise<unknown>) => {
      const serialized = key ? JSON.stringify(key) : null;
      const [, forceRender] = React.useReducer((count: number) => count + 1, 0);
      const [error, setError] = React.useState<unknown>(null);
      const [isLoading, setLoading] = React.useState(
        Boolean(serialized) && !swrState.cache.has(serialized!),
      );

      React.useEffect(() => {
        if (!serialized) {
          setLoading(false);
          return;
        }
        let active = true;
        setLoading(true);
        Promise.resolve()
          .then(fetcher)
          .then((data) => {
            if (!active) return;
            swrState.cache.set(serialized, data);
            setError(null);
          })
          .catch((caught) => {
            if (active) setError(caught);
          })
          .finally(() => {
            if (!active) return;
            setLoading(false);
            forceRender();
          });
        return () => {
          active = false;
        };
        // The key is the cache identity; the fetcher is an inline closure.
      }, [serialized]);

      return {
        data: serialized ? swrState.cache.get(serialized) : undefined,
        error,
        isLoading,
        mutate: async () => {
          if (!serialized) return undefined;
          const data = await fetcher();
          swrState.cache.set(serialized, data);
          forceRender();
          return data;
        },
      };
    },
  };
});

vi.mock('@/services/documentReview', () => ({
  documentReviewService: {
    analyzeImpacts: mocks.analyzeImpacts,
    applySuggestion: mocks.applySuggestion,
    confirmRuleSet: mocks.confirmRuleSet,
    createRuleSet: mocks.createRuleSet,
    createSession: mocks.createSession,
    getImpactFollowUpContext: mocks.getImpactFollowUpContext,
    getSession: mocks.getSession,
    initializeChecks: mocks.initializeChecks,
    listRuleSets: mocks.listRuleSets,
    listSessions: mocks.listSessions,
    proposeRules: mocks.proposeRules,
    recheckChecks: mocks.recheckChecks,
    runChecks: mocks.runChecks,
    suggestFix: mocks.suggestFix,
    updateSession: mocks.updateSession,
  },
}));

vi.mock('@/services/document', () => ({
  documentService: { listDocumentHistory: mocks.listDocumentHistory },
}));

vi.mock('@/services/document/invalidation', () => ({
  invalidateDocumentMutation: mocks.invalidateDocumentMutation,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => 'ws-1',
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('../store', () => ({
  selectors: {},
  usePageEditorStore: (selector: (state: { isWorkspaceScopedPage: boolean }) => unknown) =>
    selector({ isWorkspaceScopedPage: true }),
}));

const now = new Date('2026-10-21T08:00:00.000Z');

const session: DocumentReviewSessionItem = {
  accessedAt: now,
  baseHistoryId: 'hist-old',
  createdAt: now,
  documentId: 'doc-1',
  id: 'ses-1',
  ruleSetId: 'set-1',
  status: 'active',
  title: null,
  updatedAt: now,
  userId: 'user-1',
  workspaceId: 'ws-1',
};

const rule = {
  accessedAt: now,
  createdAt: now,
  id: 'rule-1',
  instruction: 'Payment must follow acceptance.',
  ruleSetId: 'set-1',
  severity: 'high' as const,
  sortOrder: 0,
  title: 'Payment trigger',
  updatedAt: now,
  workspaceId: 'ws-1',
};

const checkResult = (
  status: DocumentReviewCheckStatus,
  overrides: Partial<DocumentReviewCheckResultItem> = {},
): DocumentReviewCheckResultItem => ({
  accessedAt: now,
  appliedAt: null,
  checkedAt: null,
  createdAt: now,
  evidence: null,
  explanation: 'Because the clause says so.',
  id: 'res-1',
  ruleId: 'rule-1',
  sessionId: 'ses-1',
  status,
  suggestion: { original: 'after final acceptance', replacement: 'after each stage' },
  updatedAt: now,
  workspaceId: 'ws-1',
  ...overrides,
});

const detailWith = (results: DocumentReviewCheckResultItem[]): DocumentReviewSessionDetail => ({
  checkResults: results,
  impacts: [],
  ruleSet: {
    accessedAt: now,
    confirmedAt: now,
    confirmedByUserId: 'user-1',
    createdAt: now,
    description: null,
    documentId: 'doc-1',
    id: 'set-1',
    rules: [rule],
    status: 'confirmed',
    title: 'Contract rules',
    updatedAt: now,
    userId: 'user-1',
    workspaceId: 'ws-1',
  },
  session,
});

describe('useDocumentReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swrState.cache.clear();
    mocks.listSessions.mockResolvedValue([session]);
    mocks.listRuleSets.mockResolvedValue([detailWith([]).ruleSet]);
    mocks.getSession.mockResolvedValue(detailWith([checkResult('failed')]));
    mocks.recheckChecks.mockResolvedValue([]);
  });

  const renderReview = () => renderHook(() => useDocumentReview({ documentId: 'doc-1' }));

  it('exposes the checklist statuses and the session rule set', async () => {
    mocks.getSession.mockResolvedValue(
      detailWith([
        checkResult('passed', { id: 'res-1' }),
        checkResult('failed', { id: 'res-2' }),
        checkResult('uncertain', { id: 'res-3' }),
        checkResult('unchecked', { id: 'res-4' }),
        checkResult('needs_recheck', { id: 'res-5' }),
      ]),
    );

    const { result } = renderReview();

    await waitFor(() => expect(result.current.checkResults).toHaveLength(5));

    expect(result.current.checkResults.map((item) => item.status)).toEqual([
      'passed',
      'failed',
      'uncertain',
      'unchecked',
      'needs_recheck',
    ]);
    expect(result.current.ruleSet?.rules.map((item) => item.title)).toEqual(['Payment trigger']);
    expect(result.current.session?.id).toBe('ses-1');
    expect(result.current.actionError).toBeNull();
  });

  it('shows needs_recheck right after applying a fix, then the re-check verdict', async () => {
    const applied = checkResult('needs_recheck', { appliedAt: now });
    mocks.applySuggestion.mockResolvedValue(applied);
    const passed = checkResult('passed', { appliedAt: now });
    mocks.recheckChecks.mockResolvedValue([passed]);
    let serverDetail = detailWith([checkResult('failed')]);
    mocks.getSession.mockImplementation(async () => serverDetail);

    const { result } = renderReview();
    await waitFor(() => expect(result.current.checkResults).toHaveLength(1));

    await act(async () => {
      await result.current.applySuggestion('res-1', 'after each stage');
    });

    expect(mocks.applySuggestion).toHaveBeenCalledWith({
      appliedText: 'after each stage',
      checkResultId: 'res-1',
    });
    expect(result.current.pendingAction).toBeNull();
    expect(result.current.actionError).toBeNull();
    expect(result.current.statusOverrides['res-1']).toBe('needs_recheck');
    expect(
      resolveCheckStatus(
        { result: result.current.checkResults[0] },
        result.current.statusOverrides,
      ),
    ).toBe('needs_recheck');

    serverDetail = detailWith([passed]);
    await act(async () => {
      await result.current.recheck(['res-1']);
    });

    expect(mocks.recheckChecks).toHaveBeenCalledWith({
      checkResultIds: ['res-1'],
      sessionId: 'ses-1',
    });
    // The optimistic needs_recheck paint is dropped, so the row no longer
    // reports needs_recheck after a verdict came back.
    expect(result.current.statusOverrides).toEqual({});
    expect(result.current.statusOverrides['res-1']).toBeUndefined();
  });

  it('does not mark a fix as applied when the anchor is gone', async () => {
    mocks.applySuggestion.mockRejectedValue(new Error('找不到要替换的原文'));

    const { result } = renderReview();
    await waitFor(() => expect(result.current.checkResults).toHaveLength(1));

    await act(async () => {
      await result.current.applySuggestion('res-1', 'changed text');
    });

    expect(result.current.statusOverrides).toEqual({});
    expect(result.current.actionError).toEqual({
      action: 'applySuggestion',
      type: 'anchorLost',
    });
  });

  it('starts a review from the newest earlier version and runs the analysis', async () => {
    mocks.listSessions.mockResolvedValueOnce([]);
    mocks.listDocumentHistory.mockResolvedValue({
      items: [
        { id: 'hist-current', isCurrent: true },
        { id: 'hist-older', isCurrent: false },
      ],
    });
    mocks.createSession.mockResolvedValue({ ...session, id: 'ses-new' });
    mocks.analyzeImpacts.mockResolvedValue({ items: [], stats: {} });
    mocks.getSession.mockResolvedValue({
      ...detailWith([]),
      session: { ...session, id: 'ses-new' },
    });

    const { result } = renderReview();
    await waitFor(() => expect(result.current.sessions).toEqual([]));

    await act(async () => {
      await result.current.analyze();
    });

    expect(mocks.createSession).toHaveBeenCalledWith({
      baseHistoryId: 'hist-older',
      documentId: 'doc-1',
    });
    expect(mocks.analyzeImpacts).toHaveBeenCalledWith({
      baseHistoryId: 'hist-older',
      sessionId: 'ses-new',
    });
    await waitFor(() => expect(result.current.activeSessionId).toBe('ses-new'));
  });

  it('reports a missing earlier version instead of creating a session', async () => {
    mocks.listSessions.mockResolvedValueOnce([]);
    mocks.listDocumentHistory.mockResolvedValue({
      items: [{ id: 'hist-current', isCurrent: true }],
    });

    const { result } = renderReview();
    await waitFor(() => expect(result.current.sessions).toEqual([]));

    await act(async () => {
      await result.current.analyze();
    });

    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(result.current.actionError).toEqual({ action: 'analyze', type: 'noBaseline' });
  });
  it('refreshes the document replica after applying a fix', async () => {
    mocks.applySuggestion.mockResolvedValue(checkResult('needs_recheck', { appliedAt: now }));

    const { result } = renderReview();
    await waitFor(() => expect(result.current.checkResults).toHaveLength(1));

    await act(async () => {
      await result.current.applySuggestion('res-1', 'after each stage');
    });

    // The same window wrote the body, so the resource event stream skips its
    // echo; without this refresh the editor keeps the pre-fix text.
    expect(mocks.invalidateDocumentMutation).toHaveBeenCalledWith({
      cause: 'document-service',
      documentId: 'doc-1',
    });
    expect(result.current.actionError).toBeNull();
  });

  it('still applies the fix when the refresh after it fails', async () => {
    mocks.applySuggestion.mockResolvedValue(checkResult('needs_recheck', { appliedAt: now }));
    mocks.invalidateDocumentMutation.mockRejectedValue(new Error('offline'));

    const { result } = renderReview();
    await waitFor(() => expect(result.current.checkResults).toHaveLength(1));

    await act(async () => {
      await result.current.applySuggestion('res-1', 'after each stage');
    });

    expect(result.current.statusOverrides['res-1']).toBe('needs_recheck');
    expect(result.current.actionError).toBeNull();
  });

  it('drops the selection when the panel switches to another document', async () => {
    const { result, rerender } = renderHook(
      ({ documentId }: { documentId: string }) => useDocumentReview({ documentId }),
      { initialProps: { documentId: 'doc-1' } },
    );

    await waitFor(() => expect(result.current.activeSessionId).toBe('ses-1'));

    await act(async () => {
      result.current.selectSession('ses-1');
    });
    expect(result.current.activeSessionId).toBe('ses-1');

    mocks.listSessions.mockResolvedValue([]);
    rerender({ documentId: 'doc-2' });

    // doc-1's session must not stay selected over doc-2's (empty) list.
    await waitFor(() => expect(result.current.activeSessionId).toBeNull());
  });

  it('initialises check rows before every run, not only on an empty checklist', async () => {
    mocks.initializeChecks.mockResolvedValue([]);
    mocks.runChecks.mockResolvedValue([]);

    const { result } = renderReview();
    await waitFor(() => expect(result.current.checkResults).toHaveLength(1));

    await act(async () => {
      await result.current.runChecks();
    });

    expect(mocks.initializeChecks).toHaveBeenCalledWith('ses-1');
    expect(mocks.runChecks).toHaveBeenCalledWith({ checkResultIds: undefined, sessionId: 'ses-1' });
  });
});

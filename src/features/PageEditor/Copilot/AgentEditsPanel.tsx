'use client';

import { agentDisplayName } from '@lobechat/types';
import {
  type CapturedCollaborativeRewriteSelection,
  IAISessionService,
  type IEditor,
  isAgentAwarenessState,
  IYjsService,
  type YjsAwarenessUser,
} from '@lobehub/editor';
import { DropdownMenu, Empty, Icon } from '@lobehub/ui';
import {
  ActionIcon,
  Alert,
  Button,
  confirmModal,
  type DropdownItem,
  Text,
} from '@lobehub/ui/base-ui';
import { cssVar, cx } from 'antd-style';
import {
  BotIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MapPinIcon,
  MoreHorizontalIcon,
  PenLineIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import {
  clearPageAIProvenanceFocus,
  focusPageAIProvenance,
  inspectPageAIProvenanceContinuation,
  setPageAIProvenanceHighlight,
} from '../EditorCanvas/aiProvenance';
import { usePageEditorEditorLifecycle } from '../PageEditorProvider';
import { usePageRewriteComposer } from '../rewriteComposerContext';
import { usePageEditorStore } from '../store';
import {
  getBlockImagePlaceholderState,
  isBlockImagePlaceholderSelection,
  isBlockImageRewriteSelection,
  isCurrentBlockImagePlaceholder,
  removeBlockImagePlaceholder,
  setBlockImagePlaceholderStatus,
} from './imageRewrite';
import { styles } from './rewrite.styles';
import RewriteComposer from './RewriteComposer';
import { getRewriteFailureKey } from './rewriteFailure';
import {
  getActivePageRewriteRequestIds,
  getPageRewriteErrorMessage,
  getRewriteQuotedText,
  groupPageRewriteRequests,
  isPageRewriteActiveStatus,
  PAGE_REWRITE_MAX_ACTIVE_REQUESTS,
  type PageRewriteRequest,
  pageRewriteRequestClient,
  type PageRewriteSessionGroup,
  type PageRewriteStatus,
  usePageRewriteRequests,
} from './rewriteRequests';

const TERMINAL_RETRY_STATUSES = new Set<PageRewriteStatus>(['canceled', 'failed', 'stale']);
const CANCELLABLE_STATUSES = new Set<PageRewriteStatus>([
  'queued',
  'connecting',
  'syncing',
  'thinking',
  'writing',
  'retry_wait',
]);
const ORIGINAL_SELECTION_STATUSES = new Set<PageRewriteStatus>([
  'canceled',
  'failed',
  'retry_wait',
  'stale',
]);
const DELETABLE_STATUSES = new Set<PageRewriteStatus>([
  'applied',
  'canceled',
  'canceled_after_write',
  'failed',
  'rejected',
  'stale',
]);
const REQUEST_DETAILS_STATUSES = new Set<PageRewriteStatus>([
  'canceled',
  'canceled_after_write',
  'failed',
  'retry_wait',
  'stale',
]);
const ACTIVE_AWARENESS_STATUSES = new Set(['connecting', 'syncing', 'thinking', 'writing']);
const IMAGE_PLACEHOLDER_CLEANUP_STATUSES = new Set<PageRewriteStatus>([
  'canceled',
  'canceled_after_write',
  'failed',
  'rejected',
  'stale',
]);

const getBlockImageTargetNodeId = (selection: unknown): string | null => {
  if (!isBlockImageRewriteSelection(selection) || typeof selection !== 'object' || !selection)
    return null;
  const targetNodeId = (selection as Record<string, unknown>).targetNodeId;
  return typeof targetNodeId === 'string' && targetNodeId.length > 0 ? targetNodeId : null;
};

export const canCancelPageRewrite = (status: PageRewriteStatus): boolean =>
  CANCELLABLE_STATUSES.has(status);

export const canRetryPageRewrite = (status: PageRewriteStatus): boolean =>
  TERMINAL_RETRY_STATUSES.has(status);

export const canDeletePageRewriteSession = (requests: readonly PageRewriteRequest[]): boolean =>
  requests.length > 0 && requests.every((request) => DELETABLE_STATUSES.has(request.status));

const statusKey = (status: PageRewriteStatus): string =>
  `copilot.rewrite.status.${status.replaceAll('_', '-')}`;

const getContinuationSelectionKey = (
  selection: PageRewriteRequest['selection'] | undefined,
): string => {
  if (!selection || typeof selection !== 'object') return '';
  const candidate = selection as Record<string, unknown>;
  const targetNodeIds = Array.isArray(candidate.targetNodeIds)
    ? candidate.targetNodeIds
        .filter((nodeId): nodeId is string => typeof nodeId === 'string')
        .sort()
        .join(',')
    : '';
  // The server refreshes quotedText/quotedTextHash for a continuation against
  // the current document (for node targets this is the generated source). The
  // durable range identity, not that mutable proof text, decides whether the
  // user is still on the same session. selectionVersion separately detects a
  // fresh user capture.
  return [
    candidate.kind,
    candidate.roomId,
    candidate.adapterId,
    candidate.targetKind,
    candidate.targetNodeId,
    targetNodeIds,
    candidate.startNodeId,
    candidate.startOffset,
    candidate.endNodeId,
    candidate.endOffset,
  ]
    .map((value) => String(value ?? ''))
    .join('\u0000');
};

const getAppliedTextHash = (
  selection: PageRewriteRequest['selection'] | undefined,
): string | null => {
  if (!selection || typeof selection !== 'object') return null;
  const value = (selection as Record<string, unknown>).appliedTextHash;
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const Awareness = memo<{
  documentId?: string;
  editor?: IEditor;
  onActiveRequestIds?: (requestIds: string[]) => void;
}>(({ documentId, editor, onActiveRequestIds }) => {
  const { t } = useTranslation('editor');
  const [awarenessUsers, setAwarenessUsers] = useState<YjsAwarenessUser[]>([]);

  useEffect(() => {
    const service = editor?.requireService(IYjsService);
    if (!service) {
      setAwarenessUsers([]);
      return;
    }

    return service.subscribeAwarenessUsers((users) => {
      setAwarenessUsers(users);
    });
  }, [editor]);

  const agents = awarenessUsers.filter(({ state }) => {
    return (
      isAgentAwarenessState(state) && (!documentId || state.awarenessData.documentId === documentId)
    );
  });
  const activeRequestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const { state } of agents) {
      if (!isAgentAwarenessState(state)) continue;
      if (!ACTIVE_AWARENESS_STATUSES.has(state.awarenessData.status)) continue;
      if (state.awarenessData.requestId) ids.add(state.awarenessData.requestId);
    }
    return [...ids];
  }, [agents]);

  useEffect(() => {
    onActiveRequestIds?.(activeRequestIds);
  }, [activeRequestIds, onActiveRequestIds]);

  if (agents.length === 0) return null;

  return (
    <div data-agent-awareness className={styles.awareness}>
      <Text type="secondary">{t('copilot.rewrite.activeAgents')}</Text>
      {agents.map(({ clientId, state }) => {
        if (!isAgentAwarenessState(state)) return null;
        const status = state.awarenessData.status;
        return (
          <div className={styles.awarenessItem} key={clientId}>
            <span
              aria-hidden="true"
              className={styles.awarenessDot}
              style={{ background: state.color || cssVar.colorInfo }}
            />
            <Text ellipsis>{state.name || t('copilot.rewrite.agent')}</Text>
            <Text color={cssVar.colorTextTertiary} fontSize={12}>
              {t(`copilot.rewrite.awareness.${status}`, { defaultValue: status })}
            </Text>
          </div>
        );
      })}
    </div>
  );
});

Awareness.displayName = 'PageAgentAwareness';

type RequestActionsProps = {
  busy: string | null;
  compact?: boolean;
  continueRequest?: PageRewriteRequest | null;
  isPlaceholder?: boolean;
  onCancel: (request: PageRewriteRequest) => void;
  onContinue: (request: PageRewriteRequest) => void;
  onFocus: (request: PageRewriteRequest) => void;
  onRemovePlaceholder?: (request: PageRewriteRequest) => void;
  onRetry: (request: PageRewriteRequest) => void;
  request: PageRewriteRequest;
};

const RequestActions = memo<RequestActionsProps>(
  ({
    busy,
    compact = false,
    continueRequest,
    isPlaceholder = false,
    onCancel,
    onContinue,
    onFocus,
    onRemovePlaceholder,
    onRetry,
    request,
  }) => {
    const { t } = useTranslation('editor');
    const canCancel = canCancelPageRewrite(request.status);
    const canRetry = canRetryPageRewrite(request.status);
    const canContinue =
      continueRequest?.status === 'applied' &&
      Boolean(continueRequest.sessionId && continueRequest.outputText);
    const canRemovePlaceholder =
      Boolean(onRemovePlaceholder) &&
      isPlaceholder &&
      IMAGE_PLACEHOLDER_CLEANUP_STATUSES.has(request.status);
    const isBusy = busy === request.id;

    return (
      <div className={cx(styles.controls, compact && styles.historyControls)}>
        <Button
          aria-label={t('copilot.rewrite.viewAnchor')}
          icon={<MapPinIcon size={14} />}
          size="small"
          type="text"
          onClick={() => onFocus(request)}
        >
          {t('copilot.rewrite.viewAnchor')}
        </Button>
        {canRetry && (
          <Button
            disabled={isBusy}
            icon={<RotateCcwIcon size={14} />}
            loading={isBusy}
            size="small"
            onClick={() => onRetry(request)}
          >
            {t('copilot.rewrite.retry')}
          </Button>
        )}
        {canContinue && continueRequest && (
          <Button
            aria-label={t('copilot.rewrite.continue', { defaultValue: 'Continue' })}
            icon={<PenLineIcon size={14} />}
            size="small"
            onClick={() => onContinue(continueRequest)}
          >
            {t('copilot.rewrite.continue', { defaultValue: 'Continue' })}
          </Button>
        )}
        {canRemovePlaceholder && (
          <Button
            aria-label={t('copilot.rewrite.removePlaceholder')}
            size="small"
            type="text"
            onClick={() => onRemovePlaceholder?.(request)}
          >
            {t('copilot.rewrite.removePlaceholder')}
          </Button>
        )}
        {canCancel && (
          <Button
            disabled={isBusy}
            icon={<XIcon size={14} />}
            loading={isBusy}
            size="small"
            type="text"
            onClick={() => onCancel(request)}
          >
            {t('copilot.rewrite.cancel')}
          </Button>
        )}
      </div>
    );
  },
);

RequestActions.displayName = 'PageRewriteRequestActions';

const HistoryRequestRow = memo<{
  busy: string | null;
  canContinueSession: boolean;
  isPlaceholder?: boolean;
  onCancel: (request: PageRewriteRequest) => void;
  onContinue: (request: PageRewriteRequest) => void;
  onFocus: (request: PageRewriteRequest) => void;
  onHighlight: (request: PageRewriteRequest, active: boolean) => void;
  onRemovePlaceholder?: (request: PageRewriteRequest) => void;
  onRetry: (request: PageRewriteRequest) => void;
  request: PageRewriteRequest;
}>(
  ({
    busy,
    canContinueSession,
    isPlaceholder = false,
    onCancel,
    onContinue,
    onFocus,
    onHighlight,
    onRemovePlaceholder,
    onRetry,
    request,
  }) => {
    const { t } = useTranslation('editor');
    const statusLabel = t(statusKey(request.status), { defaultValue: request.status });

    return (
      <div
        className={styles.historyRow}
        data-ai-session-id={request.sessionId ?? undefined}
        data-rewrite-request-id={request.id}
        onBlur={() => onHighlight(request, false)}
        onFocus={() => onHighlight(request, true)}
        onMouseEnter={() => onHighlight(request, true)}
        onMouseLeave={() => onHighlight(request, false)}
      >
        <div className={styles.historyRowMain}>
          <Text className={styles.historyRound}>
            {t('copilot.rewrite.round', { count: request.turnIndex ?? 1 })}
          </Text>
          <Text ellipsis className={styles.historyInstruction}>
            {request.instruction || t('copilot.rewrite.noInstruction')}
          </Text>
        </div>
        <Text
          className={styles.historyStatus}
          type={request.status === 'failed' || request.status === 'stale' ? 'danger' : 'secondary'}
          data-rewrite-status={
            isPageRewriteActiveStatus(request.status)
              ? 'active'
              : request.status === 'failed' || request.status === 'stale'
                ? request.status
                : request.status === 'applied'
                  ? 'applied'
                  : undefined
          }
        >
          {statusLabel}
        </Text>
        <RequestActions
          compact
          busy={busy}
          continueRequest={canContinueSession ? request : null}
          isPlaceholder={isPlaceholder}
          request={request}
          onCancel={onCancel}
          onContinue={onContinue}
          onFocus={onFocus}
          onRemovePlaceholder={onRemovePlaceholder}
          onRetry={onRetry}
        />
      </div>
    );
  },
);

HistoryRequestRow.displayName = 'PageRewriteHistoryRequestRow';

const getRequestPriority = (request: PageRewriteRequest): 'active' | 'attention' | undefined => {
  if (isPageRewriteActiveStatus(request.status)) return 'active';
  if (request.status === 'failed' || request.status === 'stale') return 'attention';
  return undefined;
};

const RequestCard = memo<{
  busy: string | null;
  expanded: boolean;
  group: PageRewriteSessionGroup;
  placeholderRequestIds: ReadonlySet<string>;
  onCancel: (request: PageRewriteRequest) => void;
  onContinue: (request: PageRewriteRequest) => void;
  onFocus: (request: PageRewriteRequest) => void;
  onHighlight: (request: PageRewriteRequest, active: boolean) => void;
  onDelete: (request: PageRewriteRequest) => void;
  onRemovePlaceholder?: (request: PageRewriteRequest) => void;
  onRetry: (request: PageRewriteRequest) => void;
  onToggleHistory: () => void;
}>(
  ({
    busy,
    expanded,
    group,
    placeholderRequestIds,
    onCancel,
    onContinue,
    onFocus,
    onHighlight,
    onDelete,
    onRemovePlaceholder,
    onRetry,
    onToggleHistory,
  }) => {
    const { t } = useTranslation('editor');
    const request = group.requests[0]!;
    const agent = useAgentStore((s) => agentByIdSelectors.getAgentConfigById(request.agentId)(s));
    const displayName = agentDisplayName(agent, request.agentId);
    const statusLabel = t(statusKey(request.status), { defaultValue: request.status });
    const priority = getRequestPriority(request);
    const showOriginalSelection = ORIGINAL_SELECTION_STATUSES.has(request.status);
    const quotedText = showOriginalSelection ? getRewriteQuotedText(request) : '';
    const showError =
      Boolean(request.errorMessage) &&
      (request.status !== 'applied' || request.errorCode === 'CANCELED_AFTER_WRITE');
    const showDetails = REQUEST_DETAILS_STATUSES.has(request.status) || showError;
    const [detailsOpen, setDetailsOpen] = useState(false);
    const hasActiveRound = group.requests.some((item) => isPageRewriteActiveStatus(item.status));
    const lastAppliedRequest = group.requests.find((item) => item.status === 'applied');
    const continuationRequest = hasActiveRound
      ? undefined
      : group.requests.find(
          (item) => item.status === 'applied' && item.sessionId && item.outputText,
        );
    const hasHistory = group.requests.length > 1;
    const canDelete = canDeletePageRewriteSession(group.requests);
    const historyId = `page-rewrite-history-${group.key}`;

    return (
      <div className={styles.sessionGroup} data-rewrite-session-key={group.key}>
        <div
          className={styles.requestCard}
          data-ai-session-id={request.sessionId ?? undefined}
          data-rewrite-priority={priority}
          data-rewrite-request-id={request.id}
          onBlur={() => onHighlight(request, false)}
          onFocus={() => onHighlight(request, true)}
          onMouseEnter={() => onHighlight(request, true)}
          onMouseLeave={() => onHighlight(request, false)}
        >
          <div className={styles.requestHeader}>
            <div className={styles.requestAgent}>
              <Icon icon={BotIcon} size={16} />
              <Text ellipsis strong>
                {displayName}
              </Text>
            </div>
            <div className={styles.requestHeaderActions}>
              <Text
                className={styles.status}
                data-rewrite-status={
                  isPageRewriteActiveStatus(request.status)
                    ? 'active'
                    : request.status === 'failed' || request.status === 'stale'
                      ? request.status
                      : request.status === 'applied'
                        ? 'applied'
                        : undefined
                }
                type={
                  request.status === 'failed' || request.status === 'stale' ? 'danger' : 'secondary'
                }
              >
                {statusLabel}
              </Text>
              {canDelete && (
                <DropdownMenu
                  items={[
                    {
                      danger: true,
                      icon: <Trash2Icon size={14} />,
                      key: 'delete-rewrite-session',
                      label: t('copilot.rewrite.delete'),
                      onClick: () => onDelete(request),
                    } satisfies DropdownItem,
                  ]}
                >
                  <ActionIcon
                    aria-label={t('copilot.rewrite.more')}
                    icon={MoreHorizontalIcon}
                    size="small"
                    title={t('copilot.rewrite.more')}
                  />
                </DropdownMenu>
              )}
            </div>
          </div>
          {hasHistory && (
            <div className={styles.sessionMeta}>
              <Text className={styles.sessionRounds}>
                {t('copilot.rewrite.sessionRounds', { count: group.requests.length })}
              </Text>
              <button
                aria-controls={historyId}
                aria-expanded={expanded}
                className={styles.historyToggle}
                type="button"
                onClick={onToggleHistory}
              >
                {expanded ? t('copilot.rewrite.hideHistory') : t('copilot.rewrite.showHistory')}
                {expanded ? (
                  <ChevronUpIcon aria-hidden="true" size={14} />
                ) : (
                  <ChevronDownIcon aria-hidden="true" size={14} />
                )}
              </button>
            </div>
          )}
          <Text className={styles.instruction}>
            {request.instruction || t('copilot.rewrite.noInstruction')}
          </Text>
          {lastAppliedRequest && lastAppliedRequest.id !== request.id && (
            <div data-rewrite-last-applied className={styles.appliedContext}>
              <Text className={styles.appliedContextLabel} type="success">
                {t('copilot.rewrite.lastApplied', {
                  count: lastAppliedRequest.turnIndex ?? 1,
                })}
              </Text>
              {continuationRequest && (
                <Button
                  aria-label={t('copilot.rewrite.continue', { defaultValue: 'Continue' })}
                  icon={<PenLineIcon size={13} />}
                  size="small"
                  type="text"
                  onClick={() => onContinue(continuationRequest)}
                >
                  {t('copilot.rewrite.continue', { defaultValue: 'Continue' })}
                </Button>
              )}
            </div>
          )}
          {showDetails && (
            <details
              data-rewrite-details
              className={styles.requestDetails}
              open={detailsOpen}
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            >
              <summary className={styles.requestDetailsSummary}>
                {detailsOpen ? t('copilot.rewrite.hideDetails') : t('copilot.rewrite.showDetails')}
              </summary>
              <div className={styles.requestDetailsContent}>
                {showOriginalSelection && (
                  <Text data-rewrite-original-selection className={styles.quotePreview}>
                    <Text as="span" className={styles.quoteLabel}>
                      {t('copilot.rewrite.originalSelection')}
                    </Text>
                    {quotedText || t('annotation.noQuote')}
                  </Text>
                )}
                {showError && request.errorMessage && (
                  <Text className={styles.error} role="alert">
                    {request.errorCode?.startsWith('DOCUMENT_REWRITE_PRODUCTION_')
                      ? t(getRewriteFailureKey(request.errorCode))
                      : getPageRewriteErrorMessage(
                          request.errorMessage,
                          t('copilot.rewrite.actionError'),
                        )}
                  </Text>
                )}
              </div>
            </details>
          )}
          <RequestActions
            busy={busy}
            isPlaceholder={placeholderRequestIds.has(request.id)}
            request={request}
            continueRequest={
              continuationRequest && continuationRequest.id === request.id
                ? continuationRequest
                : null
            }
            onCancel={onCancel}
            onContinue={onContinue}
            onFocus={onFocus}
            onRemovePlaceholder={onRemovePlaceholder}
            onRetry={onRetry}
          />
        </div>
        {expanded && (
          <div
            aria-label={t('copilot.rewrite.history')}
            className={styles.historyList}
            id={historyId}
          >
            {group.requests.slice(1).map((historyRequest) => (
              <HistoryRequestRow
                busy={busy}
                canContinueSession={!hasActiveRound}
                isPlaceholder={placeholderRequestIds.has(historyRequest.id)}
                key={historyRequest.id}
                request={historyRequest}
                onCancel={onCancel}
                onContinue={onContinue}
                onFocus={onFocus}
                onHighlight={onHighlight}
                onRemovePlaceholder={onRemovePlaceholder}
                onRetry={onRetry}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
);

RequestCard.displayName = 'PageRewriteSessionCard';

const AgentEditsPanel = memo(() => {
  const { t } = useTranslation('editor');
  const storeEditor = usePageEditorStore((s) => s.editor);
  const editorLifecycle = usePageEditorEditorLifecycle();
  const editor = editorLifecycle?.editor ?? storeEditor;
  const documentId = usePageEditorStore((s) => s.documentId);
  const {
    close,
    draftHighlightVisible,
    setDraftHighlightVisible,
    selection,
    selectionVersion,
    setContinuationTarget,
  } = usePageRewriteComposer();
  const { error, isLoading, isValidating, mutate, requests } = usePageRewriteRequests(documentId);
  const [busy, setBusy] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [activeAwarenessRequestIds, setActiveAwarenessRequestIds] = useState<string[]>([]);
  const [continuationParent, setContinuationParent] = useState<PageRewriteRequest | null>(null);
  const [newSessionKey, setNewSessionKey] = useState<string | null>(null);
  const [newSessionSelectionVersion, setNewSessionSelectionVersion] = useState<number | null>(null);
  const [expandedSessionKeys, setExpandedSessionKeys] = useState<Set<string>>(() => new Set());
  const [editorRevision, setEditorRevision] = useState(0);
  const continuationSelectionVersionRef = useRef<number | null>(null);
  const selectionVersionRef = useRef(selectionVersion);
  const handledSelectionVersionRef = useRef(selectionVersion);
  selectionVersionRef.current = selectionVersion;
  const currentEditorRef = useRef(editor);
  currentEditorRef.current = editor;
  const currentContinuationParentRef = useRef(continuationParent);
  currentContinuationParentRef.current = continuationParent;

  useEffect(() => {
    setContinuationParent(null);
    setNewSessionKey(null);
    setNewSessionSelectionVersion(null);
    continuationSelectionVersionRef.current = null;
    clearPageAIProvenanceFocus(currentEditorRef.current);
    setContinuationTarget(null);
  }, [documentId, setContinuationTarget]);

  useEffect(() => {
    // `selectionVersion` only changes for a fresh editor capture. Treat that
    // capture as an atomic new draft, even when the previous request is still
    // running or has already produced an applied session. In particular, do
    // not let the old session's topic transcript leak into the new composer.
    if (handledSelectionVersionRef.current === selectionVersion) return;
    handledSelectionVersionRef.current = selectionVersion;
    setContinuationParent(null);
    setNewSessionKey(null);
    setNewSessionSelectionVersion(null);
    continuationSelectionVersionRef.current = null;
    clearPageAIProvenanceFocus(currentEditorRef.current);
    setContinuationTarget(null);
  }, [selectionVersion, setContinuationTarget]);

  useEffect(() => {
    if (selection || continuationParent) return;
    setNewSessionKey(null);
    setNewSessionSelectionVersion(null);
  }, [continuationParent, selection]);

  useEffect(() => {
    if (
      continuationParent &&
      selection &&
      continuationSelectionVersionRef.current !== null &&
      selectionVersion !== continuationSelectionVersionRef.current
    ) {
      return;
    }
    if (
      continuationParent &&
      selection &&
      getContinuationSelectionKey(continuationParent.selection) !==
        getContinuationSelectionKey(selection)
    ) {
      return;
    }
    if (!continuationParent) {
      clearPageAIProvenanceFocus(editor);
      setContinuationTarget(null);
      return;
    }
    if (!draftHighlightVisible) {
      clearPageAIProvenanceFocus(editor);
      return;
    }

    let unavailableFallbackAttempted = false;
    const syncContinuationFocus = () => {
      const continuation = inspectPageAIProvenanceContinuation(editor, {
        appliedTextHash: getAppliedTextHash(continuationParent.selection),
        outputText: continuationParent.outputText,
        sessionId: continuationParent.sessionId,
      });

      if (continuation.status === 'changed' || continuation.status === 'deleted') return;
      if (continuation.status === 'unavailable' && unavailableFallbackAttempted) return;
      unavailableFallbackAttempted = continuation.status === 'unavailable';

      focusPageAIProvenance(editor, {
        focusEditor: false,
        highlight: false,
        requestId: continuationParent.id,
        selection: continuationParent.selection,
        sessionId: continuationParent.sessionId ?? undefined,
      });
    };

    syncContinuationFocus();
    return editor?.requireService(IAISessionService)?.subscribe(syncContinuationFocus);
  }, [
    continuationParent,
    draftHighlightVisible,
    editor,
    selection,
    selectionVersion,
    setContinuationTarget,
  ]);

  useEffect(
    () => () => {
      clearPageAIProvenanceFocus(currentEditorRef.current);
    },
    [],
  );

  const handleActiveAwarenessRequestIds = useCallback((requestIds: string[]) => {
    setActiveAwarenessRequestIds((current) =>
      current.length === requestIds.length && current.every((id, index) => id === requestIds[index])
        ? current
        : requestIds,
    );
  }, []);

  const activeRequestIds = useMemo(() => {
    const ids = new Set(getActivePageRewriteRequestIds(requests));
    activeAwarenessRequestIds.forEach((id) => ids.add(id));
    return [...ids];
  }, [activeAwarenessRequestIds, requests]);
  const activeRequestCount = activeRequestIds.length;
  const activeLimitReached = activeRequestCount >= PAGE_REWRITE_MAX_ACTIVE_REQUESTS;

  const handleCancel = useCallback(
    async (request: PageRewriteRequest) => {
      setBusy(request.id);
      setMutationError(null);
      try {
        await pageRewriteRequestClient.cancel({ attempt: request.attempt, id: request.id });
        await mutate();
      } catch (cause) {
        setMutationError(getPageRewriteErrorMessage(cause, t('copilot.rewrite.actionError')));
      } finally {
        setBusy(null);
      }
    },
    [mutate, t],
  );

  const handleRetry = useCallback(
    async (request: PageRewriteRequest) => {
      setBusy(request.id);
      setMutationError(null);
      const isPlaceholder = isCurrentBlockImagePlaceholder(editor, request.selection);
      if (isPlaceholder) setBlockImagePlaceholderStatus(editor, request.selection, 'loading');
      try {
        await pageRewriteRequestClient.retry({ attempt: request.attempt, id: request.id });
        await mutate();
      } catch (cause) {
        if (isPlaceholder) setBlockImagePlaceholderStatus(editor, request.selection, 'error');
        setMutationError(getPageRewriteErrorMessage(cause, t('copilot.rewrite.actionError')));
      } finally {
        setBusy(null);
      }
    },
    [editor, mutate, t],
  );

  const handleRemovePlaceholder = useCallback(
    (selectionToRemove: PageRewriteRequest['selection']) => {
      if (!removeBlockImagePlaceholder(editor, selectionToRemove)) return;
      setContinuationParent(null);
      setNewSessionKey(null);
      setNewSessionSelectionVersion(null);
      continuationSelectionVersionRef.current = null;
      setContinuationTarget(null);
      close();
      void mutate();
    },
    [close, editor, mutate, setContinuationTarget],
  );

  const handleDelete = useCallback(
    (request: PageRewriteRequest) => {
      setMutationError(null);
      confirmModal({
        cancelText: t('cancel'),
        content: t('copilot.rewrite.deleteConfirmContent'),
        okButtonProps: { danger: true },
        okText: t('copilot.rewrite.deleteConfirmOk'),
        onOk: async () => {
          setBusy(request.id);
          try {
            await pageRewriteRequestClient.deleteSession({
              documentId: request.documentId,
              requestId: request.id,
            });
            const isContinuationSession = request.sessionId
              ? continuationParent?.sessionId === request.sessionId
              : continuationParent?.id === request.id;
            if (isContinuationSession) {
              clearPageAIProvenanceFocus(editor);
              setContinuationTarget(null);
              setContinuationParent(null);
              continuationSelectionVersionRef.current = null;
              setNewSessionKey(null);
              setNewSessionSelectionVersion(null);
            }
            await mutate();
          } catch (cause) {
            setMutationError(getPageRewriteErrorMessage(cause, t('copilot.rewrite.actionError')));
          } finally {
            setBusy(null);
          }
        },
        title: t('copilot.rewrite.deleteConfirmTitle'),
      });
    },
    [continuationParent, editor, mutate, setContinuationTarget, t],
  );

  const handleContinue = useCallback(
    (request: PageRewriteRequest) => {
      if (
        requests.some(
          (item) => item.sessionId === request.sessionId && isPageRewriteActiveStatus(item.status),
        )
      )
        return;
      setMutationError(null);
      const continuation = inspectPageAIProvenanceContinuation(editor, {
        appliedTextHash: getAppliedTextHash(request.selection),
        outputText: request.outputText,
        sessionId: request.sessionId,
      });

      if (continuation.status === 'deleted') {
        setMutationError(t('copilot.rewrite.continuationDeleted'));
        return;
      }
      if (continuation.status === 'changed') {
        setMutationError(t('copilot.rewrite.continuationChanged'));
        return;
      }

      // A local AISession projection can be temporarily empty while the
      // collaborative snapshot is hydrating. The server performs the locked,
      // persisted projection check when Continue is submitted, so still open
      // the composer and restore the durable/legacy selection as a fallback.
      focusPageAIProvenance(editor, {
        focusEditor: false,
        highlight: false,
        requestId: request.id,
        selection: request.selection,
        sessionId: request.sessionId ?? undefined,
      });
      setContinuationTarget({
        outputText: request.outputText,
        requestId: request.id,
        selection: request.selection,
        sessionId: request.sessionId,
      });
      setDraftHighlightVisible(true);
      editor?.requireService(IAISessionService)?.setHoveredSessionId(null);
      continuationSelectionVersionRef.current = selectionVersion;
      setNewSessionKey(null);
      setContinuationParent(request);
    },
    [editor, requests, selectionVersion, setContinuationTarget, setDraftHighlightVisible, t],
  );

  const handleHighlight = useCallback(
    (request: PageRewriteRequest, active: boolean) => {
      if (!request.sessionId) return;
      setPageAIProvenanceHighlight(editor, { active, sessionId: request.sessionId });
    },
    [editor],
  );

  const handleFocus = useCallback(
    (request: PageRewriteRequest) => {
      focusPageAIProvenance(editor, {
        highlight: false,
        requestId: request.id,
        selection: request.selection,
        sessionId: request.sessionId ?? undefined,
      });
    },
    [editor],
  );

  const closeContinuation = useCallback(() => {
    clearPageAIProvenanceFocus(editor);
    setContinuationTarget(null);
    setContinuationParent(null);
    continuationSelectionVersionRef.current = null;
    close();
  }, [close, editor, setContinuationTarget]);

  const handleContinuationSubmitted = useCallback(async () => {
    if (
      selectionVersionRef.current === selectionVersion &&
      currentContinuationParentRef.current?.id === continuationParent?.id
    ) {
      setDraftHighlightVisible(false);
      clearPageAIProvenanceFocus(editor);
      editor?.requireService(IAISessionService)?.setHoveredSessionId(null);
    }
    await mutate();
  }, [continuationParent, editor, mutate, selectionVersion, setDraftHighlightVisible]);

  const sessionGroups = useMemo(() => groupPageRewriteRequests(requests), [requests]);
  const placeholderCandidateRequests = useMemo(
    () =>
      requests.filter(
        (request) =>
          getBlockImageTargetNodeId(request.selection) !== null &&
          (isPageRewriteActiveStatus(request.status) ||
            IMAGE_PLACEHOLDER_CLEANUP_STATUSES.has(request.status) ||
            TERMINAL_RETRY_STATUSES.has(request.status)),
      ),
    [requests],
  );
  const placeholderTargetSelections = useMemo(() => {
    const selections = new Map<string, PageRewriteRequest['selection']>();
    const addSelection = (candidate: PageRewriteRequest['selection'] | null | undefined) => {
      const nodeId = getBlockImageTargetNodeId(candidate);
      if (nodeId) selections.set(nodeId, candidate!);
    };

    placeholderCandidateRequests.forEach((request) => addSelection(request.selection));
    addSelection(selection ?? undefined);
    addSelection(continuationParent?.selection);
    return selections;
  }, [continuationParent, placeholderCandidateRequests, selection]);
  useEffect(() => {
    if (!editor || placeholderTargetSelections.size === 0) return;
    const lexicalEditor = editor.getLexicalEditor();
    if (!lexicalEditor) return;
    return lexicalEditor.registerUpdateListener(() => {
      setEditorRevision((revision) => revision + 1);
    });
  }, [editor, placeholderTargetSelections]);
  const placeholderRequestIds = useMemo(() => {
    void editorRevision;
    const states = new Map<string, boolean>();
    placeholderTargetSelections.forEach((candidate, nodeId) => {
      states.set(nodeId, getBlockImagePlaceholderState(editor, candidate)?.placeholder === true);
    });
    return new Set(
      placeholderCandidateRequests
        .filter((request) => {
          const nodeId = getBlockImageTargetNodeId(request.selection);
          return nodeId ? states.get(nodeId) === true : false;
        })
        .map((request) => request.id),
    );
  }, [editor, editorRevision, placeholderCandidateRequests, placeholderTargetSelections]);
  const selectionKey = getContinuationSelectionKey(selection ?? undefined);
  const selectionKeyRef = useRef(selectionKey);
  selectionKeyRef.current = selectionKey;
  const continuationSelectionSourceKey = getContinuationSelectionKey(continuationParent?.selection);
  const continuationSelectionChanged = Boolean(
    continuationParent &&
    selection &&
    ((continuationSelectionVersionRef.current !== null &&
      selectionVersion !== continuationSelectionVersionRef.current) ||
      continuationSelectionSourceKey !== selectionKey),
  );
  const visibleContinuationParent = continuationSelectionChanged ? null : continuationParent;
  const continuationSelectionKey = visibleContinuationParent
    ? [
        visibleContinuationParent.id,
        visibleContinuationParent.outputText ?? '',
        getContinuationSelectionKey(visibleContinuationParent.selection),
      ].join('\u0000')
    : '';
  const continuationRequests = useMemo(() => {
    if (!visibleContinuationParent) return [];

    const sessionKey = visibleContinuationParent.sessionId || visibleContinuationParent.id;
    return (
      sessionGroups.find((group) => group.key === sessionKey)?.requests ?? [
        visibleContinuationParent,
      ]
    );
  }, [sessionGroups, visibleContinuationParent]);
  const originalContinuationRequest =
    [...continuationRequests].sort(
      (left, right) =>
        (left.turnIndex ?? 1) - (right.turnIndex ?? 1) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )[0] ?? visibleContinuationParent;
  const continuationSelectionInputRef = useRef<{
    fallbackQuotedText: string;
    selection?: PageRewriteRequest['selection'];
  }>({ fallbackQuotedText: '' });
  continuationSelectionInputRef.current = {
    fallbackQuotedText: originalContinuationRequest
      ? getRewriteQuotedText(originalContinuationRequest)
      : '',
    selection: visibleContinuationParent?.selection,
  };
  const continuationSelection = useMemo(() => {
    const input = continuationSelectionInputRef.current;
    if (!continuationSelectionKey) return null;
    if (!input.selection) return null;
    return {
      ...(input.selection as Record<string, unknown>),
      // The continuation composer is anchored to the session's first
      // selected context. Generated output belongs in the assistant history,
      // never in the selection/context shown above the composer.
      quotedText: input.fallbackQuotedText,
    } as unknown as CapturedCollaborativeRewriteSelection;
  }, [continuationSelectionKey]);

  const visibleNewSessionKey =
    continuationSelectionChanged || newSessionSelectionVersion !== selectionVersion
      ? null
      : newSessionKey;
  const newSessionRequests = useMemo(() => {
    if (!visibleNewSessionKey) return [];
    return sessionGroups.find((group) => group.key === visibleNewSessionKey)?.requests ?? [];
  }, [sessionGroups, visibleNewSessionKey]);
  const draftImagePlaceholder = useMemo(() => {
    void editorRevision;
    if (!selection || !isBlockImageRewriteSelection(selection)) return false;
    const currentState = getBlockImagePlaceholderState(editor, selection);
    if (currentState) return currentState.placeholder;
    // The metadata is useful only before the first request has been persisted;
    // normalized history/continuation rows must use the current node state.
    return newSessionRequests.length === 0 && isBlockImagePlaceholderSelection(selection);
  }, [editor, editorRevision, newSessionRequests.length, selection]);
  const continuationImagePlaceholder = useMemo(() => {
    void editorRevision;
    if (!visibleContinuationParent) return false;
    return (
      getBlockImagePlaceholderState(editor, visibleContinuationParent.selection)?.placeholder ===
      true
    );
  }, [editor, editorRevision, visibleContinuationParent]);

  const handleNewRewriteSubmitted = useCallback(async () => {
    if (selectionVersionRef.current === selectionVersion) {
      setDraftHighlightVisible(false);
      clearPageAIProvenanceFocus(editor);
      editor?.requireService(IAISessionService)?.setHoveredSessionId(null);
    }
    const nextRequests = await mutate();
    if (
      !selectionKey ||
      selectionKeyRef.current !== selectionKey ||
      selectionVersionRef.current !== selectionVersion ||
      !nextRequests
    )
      return;
    const submittedRequest = [...nextRequests]
      .filter((request) => getContinuationSelectionKey(request.selection) === selectionKey)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (submittedRequest) {
      setNewSessionKey(submittedRequest.sessionId || submittedRequest.id);
      setNewSessionSelectionVersion(selectionVersion);
    }
  }, [editor, mutate, selectionKey, selectionVersion, setDraftHighlightVisible]);

  useEffect(() => {
    if (!continuationSelectionChanged) return;
    clearPageAIProvenanceFocus(editor);
    setContinuationTarget(null);
    setContinuationParent(null);
    continuationSelectionVersionRef.current = null;
    setNewSessionKey(null);
    setNewSessionSelectionVersion(null);
  }, [continuationSelectionChanged, editor, setContinuationTarget]);

  useEffect(() => {
    if (!visibleContinuationParent) return;
    const latestApplied = continuationRequests.find(
      (request) => request.status === 'applied' && Boolean(request.outputText),
    );
    if (!latestApplied || latestApplied.id === visibleContinuationParent.id) return;

    close();
    setContinuationParent(latestApplied);
    continuationSelectionVersionRef.current = selectionVersion;
    setContinuationTarget({
      outputText: latestApplied.outputText,
      requestId: latestApplied.id,
      selection: latestApplied.selection,
      sessionId: latestApplied.sessionId,
    });
  }, [
    close,
    continuationRequests,
    selectionVersion,
    setContinuationTarget,
    visibleContinuationParent,
  ]);
  useEffect(() => {
    if (!visibleNewSessionKey || visibleContinuationParent) return;
    const latestApplied = newSessionRequests.find(
      (request) => request.status === 'applied' && Boolean(request.outputText),
    );
    if (!latestApplied) return;

    close();
    setNewSessionKey(null);
    setNewSessionSelectionVersion(null);
    continuationSelectionVersionRef.current = selectionVersion;
    setContinuationTarget({
      outputText: latestApplied.outputText,
      requestId: latestApplied.id,
      selection: latestApplied.selection,
      sessionId: latestApplied.sessionId,
    });
    setContinuationParent(latestApplied);
  }, [
    close,
    newSessionRequests,
    selectionVersion,
    setContinuationTarget,
    visibleContinuationParent,
    visibleNewSessionKey,
  ]);
  const showContinuationComposer = Boolean(visibleContinuationParent && continuationSelection);
  const showNewComposer = Boolean(selection && !visibleContinuationParent);
  const showRewriteComposer = showContinuationComposer || showNewComposer;

  const toggleSessionHistory = useCallback((key: string) => {
    setExpandedSessionKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div data-page-agent-edits-panel className={styles.panel}>
      {!showRewriteComposer && (
        <>
          <Awareness
            documentId={documentId}
            editor={editor}
            onActiveRequestIds={handleActiveAwarenessRequestIds}
          />
          <div
            data-page-rewrite-active-summary
            className={styles.activeSummary}
            data-active-count={activeRequestCount}
            data-testid="page-rewrite-active-count"
          >
            <Text
              className={styles.activeCount}
              type={activeLimitReached ? 'warning' : 'secondary'}
            >
              {t('copilot.rewrite.activeCount', {
                count: activeRequestCount,
                limit: PAGE_REWRITE_MAX_ACTIVE_REQUESTS,
              })}
            </Text>
          </div>
        </>
      )}
      {showNewComposer && selection && (
        <RewriteComposer
          activeRequestCount={activeRequestCount}
          focusKey={`new:${selectionVersion}`}
          imagePlaceholder={draftImagePlaceholder}
          selection={selection}
          sessionRequests={newSessionRequests}
          onClose={close}
          onRemovePlaceholder={() => handleRemovePlaceholder(selection)}
          onSubmitted={handleNewRewriteSubmitted}
        />
      )}
      {showContinuationComposer && visibleContinuationParent && continuationSelection && (
        <RewriteComposer
          activeRequestCount={activeRequestCount}
          continuationParent={visibleContinuationParent}
          focusKey={`continuation:${visibleContinuationParent.id}`}
          imagePlaceholder={continuationImagePlaceholder}
          selection={continuationSelection}
          sessionRequests={continuationRequests}
          onBack={closeContinuation}
          onClose={closeContinuation}
          onRemovePlaceholder={() => handleRemovePlaceholder(visibleContinuationParent.selection)}
          onSubmitted={handleContinuationSubmitted}
        />
      )}
      {error && (
        <Alert
          description={getPageRewriteErrorMessage(error, t('copilot.rewrite.loadError'))}
          type="error"
          action={
            <Button
              icon={<RefreshCwIcon size={14} />}
              size="small"
              type="text"
              onClick={() => void mutate()}
            >
              {t('copilot.rewrite.retry')}
            </Button>
          }
        />
      )}
      {mutationError && (
        <Alert
          description={mutationError}
          type="error"
          action={
            <Button size="small" type="text" onClick={() => setMutationError(null)}>
              {t('cancel')}
            </Button>
          }
        />
      )}
      {isLoading && (
        <div aria-live="polite" className={styles.loading} role="status">
          <Text type="secondary">{t('copilot.rewrite.loading')}</Text>
        </div>
      )}
      {!showRewriteComposer && !isLoading && !error && sessionGroups.length === 0 && !selection && (
        <div data-page-agent-edits-empty className={styles.empty}>
          <Empty description={t('copilot.rewrite.empty')} icon={BotIcon} />
        </div>
      )}
      {!showRewriteComposer && sessionGroups.length > 0 && (
        <div aria-busy={isValidating || undefined} className={styles.requestList}>
          {sessionGroups.map((group) => (
            <RequestCard
              busy={busy}
              expanded={expandedSessionKeys.has(group.key)}
              group={group}
              key={group.key}
              placeholderRequestIds={placeholderRequestIds}
              onCancel={handleCancel}
              onContinue={handleContinue}
              onDelete={handleDelete}
              onFocus={handleFocus}
              onHighlight={handleHighlight}
              onRemovePlaceholder={(request) => handleRemovePlaceholder(request.selection)}
              onRetry={handleRetry}
              onToggleHistory={() => toggleSessionHistory(group.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
});

AgentEditsPanel.displayName = 'PageAgentEditsPanel';

export default AgentEditsPanel;

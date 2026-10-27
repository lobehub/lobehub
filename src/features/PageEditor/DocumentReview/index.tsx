'use client';

import type { DocumentReviewTextAnchor } from '@lobechat/types';
import { Button, cssVar, Empty, Flexbox, Segmented, Select, Text, toast } from '@lobehub/ui';
import { RefreshCwIcon, ScanTextIcon, SparklesIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import NavHeader from '@/features/NavHeader';
import ToggleRightPanelButton from '@/features/RightPanel/ToggleRightPanelButton';

import { usePageAgentPanelControl } from '../RightPanel/OverrideContext';
import { selectors, usePageEditorStore } from '../store';
import ImpactList from './ImpactList';
import ProposalPanel from './ProposalPanel';
import RuleChecklist, { StatusFilterRow } from './RuleChecklist';
import type { ReviewCheckFilter } from './types';
import { useDocumentReview } from './useDocumentReview';
import { useReviewAnchor } from './useReviewAnchor';
import {
  buildCheckEntries,
  countCheckEntries,
  filterCheckEntries,
  resolveCheckStatus,
} from './utils';

const ACTION_ERROR_KEYS: Record<string, string> = {
  anchorLost: 'pageEditor.review.error.anchorLost',
  conflict: 'pageEditor.review.error.conflict',
  forbidden: 'pageEditor.review.error.forbidden',
  generic: 'pageEditor.review.error.generic',
  model: 'pageEditor.review.error.model',
  noBaseline: 'pageEditor.review.error.noBaseline',
  noDiff: 'pageEditor.review.error.noDiff',
  notFound: 'pageEditor.review.error.notFound',
};

const EmptyState = memo<{
  action?: ReactNode;
  description: string;
  icon: typeof ScanTextIcon;
  title: string;
}>(({ action, description, icon, title }) => (
  <Empty
    action={action}
    description={description}
    icon={icon}
    style={{ flex: 1, paddingBlock: 32 }}
    title={title}
    type={'default'}
  />
));

EmptyState.displayName = 'ReviewEmptyState';

const DocumentReviewPanel = memo(() => {
  const { t } = useTranslation('file');
  const documentId = usePageEditorStore(selectors.documentId);
  const [reviewTab, setReviewTab, reviewCheckFilter, setReviewCheckFilter] = usePageEditorStore(
    (s) => [s.reviewTab, s.setReviewTab, s.reviewCheckFilter, s.setReviewCheckFilter],
  );
  const [expandedIds, toggleExpanded] = usePageEditorStore((s) => [
    s.reviewExpandedIds,
    s.toggleReviewCheckExpanded,
  ]);
  const { expand, toggle } = usePageAgentPanelControl();
  const review = useDocumentReview({ documentId });
  const { askCopilot, jumpToAnchor } = useReviewAnchor();

  const entries = useMemo(
    () => buildCheckEntries(review.checkResults, review.ruleSet?.rules ?? []),
    [review.checkResults, review.ruleSet?.rules],
  );

  const counts = useMemo(
    () => countCheckEntries(entries, (entry) => resolveCheckStatus(entry, review.statusOverrides)),
    [entries, review.statusOverrides],
  );

  const visibleEntries = useMemo(
    () =>
      filterCheckEntries(entries, reviewCheckFilter, (entry) =>
        resolveCheckStatus(entry, review.statusOverrides),
      ),
    [entries, reviewCheckFilter, review.statusOverrides],
  );

  const attentionCount = counts.failed + counts.needs_recheck;
  const impactsLabel =
    review.impacts.length > 0
      ? `${t('pageEditor.review.tab.impacts')} · ${review.impacts.length}`
      : t('pageEditor.review.tab.impacts');
  const rulesLabel =
    attentionCount > 0
      ? `${t('pageEditor.review.tab.rules')} · ${attentionCount}`
      : t('pageEditor.review.tab.rules');

  const handleJump = (anchor?: DocumentReviewTextAnchor | null) => {
    const located = jumpToAnchor(anchor);
    if (!located) toast.error(t('pageEditor.review.impact.jumpFailed'));
    return located;
  };

  const handleAsk = async (impact: Parameters<typeof askCopilot>[0]) => {
    const prepared = await askCopilot(impact);
    if (!prepared) toast.error(t('pageEditor.review.impact.askFailed'));
  };

  const isDraftRuleSet = review.ruleSet?.status === 'draft';
  const canRunChecks = Boolean(review.ruleSet) && !isDraftRuleSet && counts.unchecked > 0;
  const canRecheck = Boolean(review.ruleSet) && !isDraftRuleSet && counts.needs_recheck > 0;
  // The rules toolbar can hold the commit action (`confirmRules`) next to this
  // slot. Exactly one primary per action group: when the commit button owns it,
  // the run/recheck slot steps down to the default variant.
  const hasCommitAction = reviewTab === 'rules' && isDraftRuleSet && review.canWrite;

  const toolbarAction = (() => {
    if (!review.canWrite) return null;

    if (reviewTab === 'impacts') {
      // The empty state carries the labelled call to action; once there are
      // results, re-analysing is a compact icon so the tab switch keeps its room.
      if (!review.activeSessionId || review.impacts.length === 0) return null;
      return (
        <Button
          icon={RefreshCwIcon}
          loading={review.pendingAction === 'analyze'}
          size={'small'}
          title={t('pageEditor.review.action.reanalyze')}
          type={'text'}
          onClick={review.analyze}
        />
      );
    }

    if (!review.ruleSet) return null;

    if (canRunChecks) {
      return (
        <Button
          loading={review.pendingAction === 'runChecks'}
          size={'small'}
          type={hasCommitAction ? 'default' : 'primary'}
          onClick={() => review.runChecks()}
        >
          {review.pendingAction === 'runChecks'
            ? t('pageEditor.review.action.runningChecks')
            : t('pageEditor.review.action.runChecks')}
        </Button>
      );
    }

    if (canRecheck) {
      return (
        <Button
          icon={RefreshCwIcon}
          loading={review.pendingAction === 'recheck'}
          size={'small'}
          type={hasCommitAction ? 'default' : 'primary'}
          onClick={() => review.recheck()}
        >
          {review.pendingAction === 'recheck'
            ? t('pageEditor.review.action.rechecking')
            : t('pageEditor.review.action.recheckAll')}
        </Button>
      );
    }

    return null;
  })();

  const renderBody = () => {
    if (!review.hasWorkspace) {
      return (
        <EmptyState
          description={t('pageEditor.review.empty.workspace.desc')}
          icon={ScanTextIcon}
          title={t('pageEditor.review.empty.workspace.title')}
        />
      );
    }

    if (review.sessionsLoading && review.sessions.length === 0) {
      return (
        <Flexbox padding={16}>
          <SurfaceSkeleton header={false} variant={'list'} />
        </Flexbox>
      );
    }

    if (review.error && review.sessions.length === 0) {
      return (
        <AsyncError
          error={review.error}
          title={t('pageEditor.review.error.generic')}
          variant={'block'}
          onRetry={review.retry}
        />
      );
    }

    if (review.sessions.length === 0) {
      return (
        <EmptyState
          description={t('pageEditor.review.empty.session.desc')}
          icon={ScanTextIcon}
          title={t('pageEditor.review.empty.session.title')}
          action={
            review.canWrite ? (
              <Button
                loading={review.pendingAction === 'analyze'}
                type={'primary'}
                onClick={review.analyze}
              >
                {review.pendingAction === 'analyze'
                  ? t('pageEditor.review.action.creating')
                  : t('pageEditor.review.action.createSession')}
              </Button>
            ) : undefined
          }
        />
      );
    }

    if (review.activeSessionId && !review.detail) {
      // `listSessions` can succeed while the first `getSession` fails, and a
      // session deleted between the two calls looks the same. Neither is a
      // loading state, so surface it instead of an endless skeleton.
      if (review.error) {
        return (
          <AsyncError
            error={review.error}
            title={t('pageEditor.review.error.generic')}
            variant={'block'}
            onRetry={review.retry}
          />
        );
      }

      if (!review.detailLoading) {
        return (
          <EmptyState
            description={t('pageEditor.review.error.generic')}
            icon={ScanTextIcon}
            title={t('pageEditor.review.empty.session.title')}
            action={
              <Button icon={<RefreshCwIcon />} onClick={review.retry}>
                {t('pageEditor.review.error.retry')}
              </Button>
            }
          />
        );
      }

      return (
        <Flexbox padding={16}>
          <SurfaceSkeleton header={false} variant={'list'} />
        </Flexbox>
      );
    }

    if (reviewTab === 'impacts') {
      if (review.impacts.length === 0) {
        return (
          <EmptyState
            description={t('pageEditor.review.empty.impacts.desc')}
            icon={ScanTextIcon}
            title={t('pageEditor.review.empty.impacts.title')}
            action={
              review.canWrite ? (
                <Button loading={review.pendingAction === 'analyze'} onClick={review.analyze}>
                  {review.pendingAction === 'analyze'
                    ? t('pageEditor.review.action.analyzing')
                    : t('pageEditor.review.action.analyze')}
                </Button>
              ) : undefined
            }
          />
        );
      }

      return (
        <ImpactList
          canWrite={review.canWrite}
          impacts={review.impacts}
          onAsk={handleAsk}
          onJump={handleJump}
        />
      );
    }

    // Rules tab
    if (!review.ruleSet) {
      return (
        <EmptyState
          description={t('pageEditor.review.empty.rules.desc')}
          icon={ScanTextIcon}
          title={t('pageEditor.review.empty.rules.title')}
          action={
            review.canWrite ? (
              <Button
                icon={SparklesIcon}
                loading={review.pendingAction === 'proposeRules'}
                type={'primary'}
                onClick={() => review.proposeRules()}
              >
                {review.pendingAction === 'proposeRules'
                  ? t('pageEditor.review.action.proposing')
                  : t('pageEditor.review.action.propose')}
              </Button>
            ) : undefined
          }
        />
      );
    }

    if (entries.length === 0) {
      return (
        <EmptyState
          description={t('pageEditor.review.empty.checks.desc')}
          icon={ScanTextIcon}
          title={t('pageEditor.review.empty.checks.title')}
          action={
            review.canWrite && !isDraftRuleSet ? (
              <Button
                loading={review.pendingAction === 'runChecks'}
                onClick={() => review.runChecks()}
              >
                {t('pageEditor.review.action.runChecks')}
              </Button>
            ) : undefined
          }
        />
      );
    }

    if (visibleEntries.length === 0) {
      return (
        <EmptyState
          description={t('pageEditor.review.empty.filter')}
          icon={ScanTextIcon}
          title={t('pageEditor.review.check.filter.all')}
        />
      );
    }

    return (
      <RuleChecklist
        canWrite={review.canWrite}
        entries={visibleEntries}
        expandedIds={expandedIds}
        pendingAction={review.pendingAction}
        statusOverrides={review.statusOverrides}
        onApply={(id, text) => review.applySuggestion(id, text)}
        onFilterChange={setReviewCheckFilter}
        onJump={handleJump}
        onRecheck={(id) => review.recheck([id])}
        onSuggest={(id) => review.suggestFix(id)}
        onToggle={toggleExpanded}
      />
    );
  };

  if (!documentId) return null;

  const showToolbar = review.hasWorkspace && review.sessions.length > 0 && review.detail;

  return (
    <Flexbox flex={1} height={'100%'} width={'100%'}>
      <NavHeader
        showTogglePanelButton={false}
        left={
          <Text
            ellipsis
            style={{ fontSize: 14, fontWeight: 500, marginLeft: 8 }}
            type={'secondary'}
          >
            {t('pageEditor.review.title')}
          </Text>
        }
        right={
          <ToggleRightPanelButton expand={expand} showActive={false} onToggle={() => toggle()} />
        }
      />

      {showToolbar && (
        <Flexbox
          gap={4}
          paddingBlock={6}
          style={{ borderBlockEnd: `1px solid ${cssVar.colorSplit}` }}
        >
          <Flexbox horizontal align={'center'} gap={8} paddingInline={12}>
            <Segmented
              size={'small'}
              value={reviewTab}
              options={[
                { label: impactsLabel, value: 'impacts' },
                { label: rulesLabel, value: 'rules' },
              ]}
              onChange={(value) => setReviewTab(value as 'impacts' | 'rules')}
            />
            <Flexbox flex={1} />
            {toolbarAction}
          </Flexbox>

          {reviewTab === 'rules' && (
            <>
              <Flexbox horizontal align={'center'} gap={6} paddingInline={12}>
                <Select
                  placeholder={t('pageEditor.review.rules.selectPlaceholder')}
                  size={'small'}
                  style={{ flex: 1, minWidth: 120 }}
                  value={review.ruleSet?.id}
                  options={review.ruleSets.map((ruleSet) => ({
                    label: ruleSet.title,
                    value: ruleSet.id,
                  }))}
                  onChange={(value) => review.selectRuleSet(String(value))}
                />
                {review.ruleSet && (
                  <Text
                    fontSize={12}
                    style={{ whiteSpace: 'nowrap' }}
                    type={isDraftRuleSet ? 'warning' : 'success'}
                  >
                    {isDraftRuleSet
                      ? t('pageEditor.review.rules.draft')
                      : t('pageEditor.review.rules.confirmed')}
                  </Text>
                )}
                {isDraftRuleSet && review.canWrite && (
                  <Button
                    loading={review.pendingAction === 'confirmRuleSet'}
                    size={'small'}
                    type={'primary'}
                    onClick={() => review.confirmRuleSet()}
                  >
                    {t('pageEditor.review.action.confirmRules')}
                  </Button>
                )}
                {review.canWrite && (
                  <Button
                    icon={SparklesIcon}
                    loading={review.pendingAction === 'proposeRules'}
                    size={'small'}
                    title={t('pageEditor.review.action.propose')}
                    type={'text'}
                    onClick={() => review.proposeRules()}
                  />
                )}
              </Flexbox>

              {isDraftRuleSet && (
                <Text fontSize={12} style={{ paddingInline: 12 }} type={'secondary'}>
                  {t('pageEditor.review.rules.draftHint')}
                </Text>
              )}

              <StatusFilterRow
                counts={counts}
                filter={reviewCheckFilter as ReviewCheckFilter}
                onFilterChange={setReviewCheckFilter}
              />
            </>
          )}

          {reviewTab === 'rules' && review.proposals && (
            <ProposalPanel
              canWrite={review.canWrite}
              pendingAction={review.pendingAction}
              proposals={review.proposals}
              onAdopt={review.adoptRules}
              onDiscard={review.discardProposals}
            />
          )}
        </Flexbox>
      )}

      {review.actionError && (
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          paddingBlock={6}
          paddingInline={12}
          style={{
            borderBlockEnd: `1px solid ${cssVar.colorErrorBorder}`,
            background: cssVar.colorErrorBg,
          }}
        >
          <Text fontSize={12} style={{ flex: 1 }} type={'danger'}>
            {t(
              (ACTION_ERROR_KEYS[review.actionError.type] ??
                'pageEditor.review.error.generic') as any,
            )}
          </Text>
          <Button
            icon={RefreshCwIcon}
            loading={review.pendingAction !== null}
            size={'small'}
            type={'text'}
            onClick={review.retryLastAction}
          >
            {t('pageEditor.review.error.retry')}
          </Button>
        </Flexbox>
      )}

      {review.activeSessionId && review.error && review.detail ? (
        <AsyncError
          error={review.error}
          title={t('pageEditor.review.error.generic')}
          variant={'inline'}
          onRetry={review.retry}
        />
      ) : null}

      <Flexbox flex={1} style={{ overflowY: 'auto', minHeight: 0 }}>
        {renderBody()}
      </Flexbox>
    </Flexbox>
  );
});

DocumentReviewPanel.displayName = 'DocumentReviewPanel';

export default DocumentReviewPanel;

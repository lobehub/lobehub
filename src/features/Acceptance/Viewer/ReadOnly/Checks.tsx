import { Empty, Flexbox, Icon, Select, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { hasRenderableEvidence, readVisualizationManifest } from '../../Report/visualization';
import { VisualizationRenderer } from '../../Report/VisualizationRenderer';
import { checkDisplayTitle } from '../../utils';
import { useAcceptanceScope } from '../AcceptanceScope';
import { collectEvidenceById, FeedbackCard, IterationTimeline } from '../Checks/CheckHistory';
import { type CheckFilter, checkFilterState, groupChecks } from '../Checks/checkState';
import { checkHeadMeta } from '../Checks/checkStatus';
import { GroupFeedbackTrail } from '../Checks/GroupFeedbackTrail';
import {
  collectGroupFeedback,
  hasCheckHistory,
  historicalEvidenceContext,
  splitCheckReviews,
} from '../Checks/readPresentation';
import type { AcceptanceCheck } from '../Checks/types';
import ThreadEvidence from '../Comments/ThreadEvidence';
import { groupCommentThreads, threadsForCheck } from '../Comments/threads';
import { useAcceptanceCommentList } from '../Comments/useAcceptanceCommentList';
import { EvidenceList } from '../Evidence/EvidenceList';
import type { EvidenceOverlayMap } from '../Evidence/overlay';
import { useAcceptanceBundle, useEvidenceUrlRefresh } from '../useAcceptanceBundle';
import { ReadComment } from './Discussion';

const styles = stylex.create({
  check: {
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
  },
  history: {
    paddingBlock: '8px',
  },
  historySummary: {
    cursor: 'pointer',
    color: cssVar.colorTextSecondary,
  },
  summary: {
    cursor: 'pointer',
    padding: '16px',
    fontSize: cssVar.fontSize,
    overflowWrap: 'anywhere',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
});

const ReadCheck = ({
  check,
  historyOpen,
  onHistoryToggle,
  onToggle,
  open,
}: {
  check: AcceptanceCheck;
  historyOpen: boolean;
  onHistoryToggle: (open: boolean) => void;
  onToggle: (open: boolean) => void;
  open: boolean;
}) => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data: discussion } = useAcceptanceCommentList(acceptanceId);
  const refreshEvidenceUrl = useEvidenceUrlRefresh(acceptanceId);
  const meta = checkHeadMeta(check);
  const threads = threadsForCheck(groupCommentThreads(discussion?.items ?? []), check.id);
  const comments = threads.flatMap(({ root, replies }) => [root, ...replies]);
  const overlays: EvidenceOverlayMap = new Map();
  for (const comment of comments) {
    if (!comment.evidenceId || !comment.rect || comment.deletedAt) continue;
    const entries = overlays.get(comment.evidenceId) ?? [];
    entries.push({ comment: comment.content, rect: comment.rect });
    overlays.set(comment.evidenceId, entries);
  }

  const visualization = readVisualizationManifest(check.result?.metadata);
  const evidenceById = collectEvidenceById(check);
  const { activeReview, historyReviews } = splitCheckReviews(check);
  const hasHistory = hasCheckHistory(check, historyReviews);

  return (
    <details
      {...stylex.props(styles.check)}
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary {...stylex.props(styles.summary)}>
        <Icon color={meta.color} icon={meta.icon} size={16} />{' '}
        {checkDisplayTitle(check.title, t('acceptance.checks.holisticTitle'))}
        <Text fontSize={12} style={{ marginInlineStart: 8 }} type={'secondary'}>
          {t(`report.verdict.${check.state === 'not_executed' ? 'notExecuted' : check.state}`)}
        </Text>
      </summary>
      <Flexbox gap={16} padding={16} style={{ paddingBlockStart: 0 }}>
        {check.result?.toulmin?.evidence && (
          <Text style={{ whiteSpace: 'pre-wrap' }}>{check.result.toulmin.evidence}</Text>
        )}
        {visualization && <VisualizationRenderer manifest={visualization} />}
        <EvidenceList
          evidence={check.evidence}
          overlays={overlays}
          reviewNotes={activeReview?.action === 'reject' ? activeReview.annotations : undefined}
          onRefreshEvidenceUrl={refreshEvidenceUrl}
        />
        {check.state === 'not_executed' ? (
          <Text fontSize={12} type={'secondary'}>
            {t('acceptance.focus.verifierDescription.notExecuted')}
          </Text>
        ) : check.result?.toulmin?.reasoning ? (
          <Flexbox gap={4} paddingBlock={8} paddingInline={10}>
            <Text fontSize={11} type={'secondary'}>
              {t('acceptance.checks.judgeReason')}
            </Text>
            <Text fontSize={12} style={{ whiteSpace: 'pre-wrap' }}>
              {check.result.toulmin.reasoning}
            </Text>
          </Flexbox>
        ) : check.result && !hasRenderableEvidence(check.evidence.length, visualization) ? (
          <Text fontSize={12} type={'secondary'}>
            {t('acceptance.evidence.empty')}
          </Text>
        ) : null}

        {activeReview && <FeedbackCard evidenceById={evidenceById} review={activeReview} />}

        {threads.map(({ root, replies }) => {
          const historical = historicalEvidenceContext(check, root.evidenceId);
          return (
            <Flexbox horizontal align={'flex-start'} gap={12} key={root.id} wrap={'wrap'}>
              {historical && (
                <ThreadEvidence
                  stale
                  comment={root}
                  evidence={historical.evidence}
                  roundIndex={historical.roundIndex}
                />
              )}
              <Flexbox flex={1} gap={8} style={{ minWidth: 200 }}>
                <ReadComment comment={root} />
                {replies.map((reply) => (
                  <ReadComment comment={reply} key={reply.id} />
                ))}
              </Flexbox>
            </Flexbox>
          );
        })}

        {hasHistory && (
          <details
            {...stylex.props(styles.history)}
            open={historyOpen}
            onToggle={(event) => onHistoryToggle(event.currentTarget.open)}
          >
            <summary {...stylex.props(styles.historySummary)}>
              {t('acceptance.checks.iterationHistory', { count: check.revisions })}
            </summary>
            <Flexbox style={{ paddingBlockStart: 12 }}>
              <IterationTimeline
                check={check}
                evidenceById={evidenceById}
                historyReviews={historyReviews}
              />
            </Flexbox>
          </details>
        )}
      </Flexbox>
    </details>
  );
};

/** A readable checklist owns disclosure/filter state, but never mounts review actions. */
const ReadChecks = () => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const [filter, setFilter] = useState<CheckFilter>('all');
  const [openChecks, setOpenChecks] = useState<Set<string>>(() => new Set());
  const [openHistories, setOpenHistories] = useState<Set<string>>(() => new Set());
  if (!data) return null;
  const visible = data.checks.filter(
    (check) => filter === 'all' || checkFilterState(check) === filter,
  );
  const groups = groupChecks(visible, t('acceptance.group.uncategorized'));
  const groupFeedback = collectGroupFeedback(data.rounds);
  const currentRound = data.rounds.at(-1)?.run.roundIndex ?? 0;
  const updateDisclosure = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    id: string,
    open: boolean,
  ) =>
    setter((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
        <Text strong>{t('acceptance.checks.title')}</Text>
        <Select
          value={filter}
          options={(['all', 'pending', 'needsFix', 'accepted', 'ignored'] as const).map(
            (value) => ({
              label: t(`acceptance.filter.${value}`, {
                count: data.checks.filter(
                  (check) => value === 'all' || checkFilterState(check) === value,
                ).length,
              }),
              value,
            }),
          )}
          onChange={(value) => setFilter(value as CheckFilter)}
        />
      </Flexbox>
      {groups.length === 0 && <Empty description={t('report.filterEmpty')} />}
      {groups.map((group) => {
        const category = group.key === 'uncategorized' ? '' : group.label;
        return (
          <Flexbox gap={12} key={group.key}>
            {groups.length > 1 && <Text strong>{group.label}</Text>}
            <GroupFeedbackTrail
              currentRound={currentRound}
              entries={groupFeedback.filter((entry) => entry.category === category)}
            />
            {group.checks.map((check) => (
              <ReadCheck
                check={check}
                historyOpen={openHistories.has(check.id)}
                key={check.id}
                open={openChecks.has(check.id)}
                onHistoryToggle={(open) => updateDisclosure(setOpenHistories, check.id, open)}
                onToggle={(open) => updateDisclosure(setOpenChecks, check.id, open)}
              />
            ))}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
};

export default ReadChecks;

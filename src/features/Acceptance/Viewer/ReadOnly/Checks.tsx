import { Empty, Flexbox, Icon } from '@lobehub/ui';
import { Select, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { checkDisplayTitle } from '../../utils';
import { useAcceptanceScope } from '../AcceptanceScope';
import { collectEvidenceById, FeedbackCard } from '../Checks/CheckHistory';
import { type CheckFilter, checkFilterState, groupChecks } from '../Checks/checkState';
import { checkHeadMeta } from '../Checks/checkStatus';
import type { AcceptanceCheck } from '../Checks/types';
import { groupCommentThreads, threadsForCheck } from '../Comments/threads';
import { useAcceptanceCommentList } from '../Comments/useAcceptanceCommentList';
import { EvidenceList } from '../Evidence/EvidenceList';
import type { EvidenceOverlayMap } from '../Evidence/overlay';
import { useAcceptanceBundle } from '../useAcceptanceBundle';
import { ReadComment } from './Discussion';

const styles = createStaticStyles(({ css }) => ({
  check: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  summary: css`
    cursor: pointer;
    padding: 16px;
    font-size: ${cssVar.fontSize};
    overflow-wrap: anywhere;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
}));

const ReadCheck = ({ check }: { check: AcceptanceCheck }) => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data: discussion } = useAcceptanceCommentList(acceptanceId);
  const meta = checkHeadMeta(check);
  const comments = threadsForCheck(groupCommentThreads(discussion?.items ?? []), check.id).flatMap(
    ({ root, replies }) => [root, ...replies],
  );
  const overlays: EvidenceOverlayMap = new Map();
  for (const comment of comments) {
    if (!comment.evidenceId || !comment.rect || comment.deletedAt) continue;
    const entries = overlays.get(comment.evidenceId) ?? [];
    entries.push({ comment: comment.content, rect: comment.rect });
    overlays.set(comment.evidenceId, entries);
  }

  return (
    <details className={styles.check}>
      <summary className={styles.summary}>
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
        <EvidenceList evidence={check.evidence} overlays={overlays} />
        {check.reviews.map((review, index) => (
          <FeedbackCard evidenceById={collectEvidenceById(check)} key={index} review={review} />
        ))}
        {comments.map((comment) => (
          <ReadComment comment={comment} key={comment.id} />
        ))}
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
  if (!data) return null;
  const visible = data.checks.filter(
    (check) => filter === 'all' || checkFilterState(check) === filter,
  );
  const groups = groupChecks(visible, t('acceptance.group.uncategorized'));

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
      {groups.map((group) => (
        <Flexbox gap={12} key={group.key}>
          {groups.length > 1 && <Text strong>{group.label}</Text>}
          {group.checks.map((check) => (
            <ReadCheck check={check} key={check.id} />
          ))}
        </Flexbox>
      ))}
    </Flexbox>
  );
};

export default ReadChecks;

'use client';

import type { DocumentReviewCheckStatus, DocumentReviewTextAnchor } from '@lobechat/types';
import { Block, cssVar, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import RuleChecklistItem from './RuleChecklistItem';
import type { ReviewAction, ReviewCheckEntry, ReviewCheckFilter } from './types';
import { REVIEW_CHECK_STATUS_DISPLAY } from './types';
import {
  CHECK_STATUS_TONE,
  type CheckStatusCounts,
  getStatusLabelKey,
  resolveCheckStatus,
} from './utils';

interface StatusFilterRowProps {
  counts: CheckStatusCounts;
  filter: ReviewCheckFilter;
  onFilterChange: (filter: ReviewCheckFilter) => void;
}

/** Five statuses plus "all", each with its live count, in one scroll-free row. */
export const StatusFilterRow = memo<StatusFilterRowProps>(({ counts, filter, onFilterChange }) => {
  const { t } = useTranslation('file');

  const items: Array<{ key: ReviewCheckFilter; label: string }> = [
    { key: 'all', label: t('pageEditor.review.check.filter.all') },
    ...REVIEW_CHECK_STATUS_DISPLAY.map((status) => ({
      key: status as ReviewCheckFilter,
      label: t(getStatusLabelKey(status) as any),
    })),
  ];

  return (
    <Flexbox horizontal gap={2} paddingBlock={4} paddingInline={8} style={{ flexWrap: 'wrap' }}>
      {items.map((item) => {
        const active = filter === item.key;
        const count = item.key === 'all' ? counts.all : counts[item.key];
        const tone =
          item.key === 'all'
            ? undefined
            : CHECK_STATUS_TONE[item.key as keyof typeof CHECK_STATUS_TONE];

        return (
          <Block
            clickable
            key={item.key}
            paddingBlock={2}
            paddingInline={6}
            variant={'borderless'}
            style={{
              background: active ? cssVar.colorFillSecondary : undefined,
              borderRadius: 6,
            }}
            onClick={() => onFilterChange(item.key)}
          >
            <Flexbox horizontal align={'center'} gap={4}>
              <Text
                fontSize={12}
                type={
                  active && tone && tone !== 'secondary'
                    ? (tone as 'danger' | 'info' | 'success' | 'warning')
                    : undefined
                }
              >
                {item.label}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {count ?? 0}
              </Text>
            </Flexbox>
          </Block>
        );
      })}
    </Flexbox>
  );
});

StatusFilterRow.displayName = 'ReviewStatusFilterRow';

interface RuleChecklistProps {
  canWrite: boolean;
  entries: ReviewCheckEntry[];
  expandedIds: string[];
  onApply: (checkResultId: string, text: string) => void;
  onFilterChange: (filter: ReviewCheckFilter) => void;
  onJump: (anchor?: DocumentReviewTextAnchor | null) => boolean;
  onRecheck: (checkResultId: string) => void;
  onSuggest: (checkResultId: string) => void;
  onToggle: (id: string) => void;
  pendingAction: ReviewAction | null;
  statusOverrides: Record<string, DocumentReviewCheckStatus>;
}

const RuleChecklist = memo<RuleChecklistProps>(
  ({
    canWrite,
    entries,
    expandedIds,
    onApply,
    onJump,
    onRecheck,
    onSuggest,
    onToggle,
    pendingAction,
    statusOverrides,
  }) => (
    <Flexbox>
      {entries.map((entry) => {
        const id = entry.result?.id ?? entry.rule?.id;
        if (!id) return null;
        const expanded = expandedIds.includes(id);

        return (
          <RuleChecklistItem
            canWrite={canWrite}
            expanded={expanded}
            key={id}
            pendingAction={pendingAction}
            result={entry.result}
            rule={entry.rule}
            status={resolveCheckStatus(entry, statusOverrides)}
            onApply={onApply}
            onJump={onJump}
            onRecheck={onRecheck}
            onSuggest={onSuggest}
            onToggle={() => onToggle(id)}
          />
        );
      })}
    </Flexbox>
  ),
);

RuleChecklist.displayName = 'ReviewRuleChecklist';

export default RuleChecklist;

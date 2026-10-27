'use client';

import type { DocumentReviewCheckStatus, DocumentReviewTextAnchor } from '@lobechat/types';
import { Button, cssVar, Flexbox, Icon, Tag, Text, TextArea } from '@lobehub/ui';
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleXIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  DocumentReviewCheckResultItem,
  DocumentReviewRuleItem,
} from '@/services/documentReview';

import ReviewQuote from './ReviewQuote';
import type { ReviewAction } from './types';
import { CHECK_STATUS_TONE, getSeverityLabelKey, getStatusLabelKey } from './utils';

export const STATUS_ICON: Record<DocumentReviewCheckStatus, typeof CheckCircle2Icon> = {
  failed: CircleXIcon,
  needs_recheck: RefreshCwIcon,
  passed: CheckCircle2Icon,
  uncertain: CircleHelpIcon,
  unchecked: CircleDashedIcon,
};

export const STATUS_COLOR: Record<DocumentReviewCheckStatus, string> = {
  failed: cssVar.colorError,
  needs_recheck: cssVar.colorInfo,
  passed: cssVar.colorSuccess,
  uncertain: cssVar.colorWarning,
  unchecked: cssVar.colorTextTertiary,
};

interface RuleChecklistItemProps {
  canWrite: boolean;
  expanded: boolean;
  onApply: (checkResultId: string, text: string) => void;
  onJump: (anchor?: DocumentReviewTextAnchor | null) => boolean;
  onRecheck: (checkResultId: string) => void;
  onSuggest: (checkResultId: string) => void;
  onToggle: () => void;
  pendingAction: ReviewAction | null;
  result?: DocumentReviewCheckResultItem;
  rule?: DocumentReviewRuleItem;
  status: DocumentReviewCheckStatus;
}

/**
 * One rule's checklist entry. The collapsed row answers "what is the state";
 * the expanded body answers "why" — rule, explanation, quoted evidence — and
 * carries the only write actions a single rule has: apply a fix, or re-check.
 */
const RuleChecklistItem = memo<RuleChecklistItemProps>(
  ({
    canWrite,
    expanded,
    onApply,
    onJump,
    onRecheck,
    onSuggest,
    onToggle,
    pendingAction,
    result,
    rule,
    status,
  }) => {
    const { t } = useTranslation('file');
    const [draft, setDraft] = useState(result?.suggestion?.replacement ?? '');

    const suggestionReplacement = result?.suggestion?.replacement;
    useEffect(() => {
      setDraft(suggestionReplacement ?? '');
    }, [result?.id, suggestionReplacement]);

    const StatusIcon = STATUS_ICON[status];
    const isBusy = Boolean(pendingAction);
    const title = rule?.title ?? t('pageEditor.review.rules.missingRule');
    const canApply = canWrite && Boolean(draft.trim()) && !isBusy;
    const showSuggestion = status === 'failed' || status === 'uncertain';

    return (
      <Flexbox style={{ borderBlockEnd: `1px solid ${cssVar.colorSplit}` }}>
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          paddingBlock={8}
          paddingInline={12}
          style={{ cursor: 'pointer' }}
          onClick={onToggle}
        >
          <Icon color={STATUS_COLOR[status]} icon={StatusIcon} size={14} />
          <Text
            fontSize={12}
            style={{ minWidth: 68, whiteSpace: 'nowrap' }}
            type={
              CHECK_STATUS_TONE[status] === 'secondary'
                ? undefined
                : (CHECK_STATUS_TONE[status] as any)
            }
          >
            {t(getStatusLabelKey(status) as any)}
          </Text>
          <Text ellipsis style={{ flex: 1, fontSize: 14, minWidth: 0 }} weight={500}>
            {title}
          </Text>
          <Tag size={'small'} variant={'borderless'}>
            {t(getSeverityLabelKey(rule?.severity) as any)}
          </Tag>
          <Icon
            color={cssVar.colorTextTertiary}
            icon={expanded ? ChevronUpIcon : ChevronDownIcon}
            size={14}
          />
        </Flexbox>

        {expanded && (
          <Flexbox gap={8} paddingBlock={'0 10px'} paddingInline={12}>
            {rule && (
              <Flexbox gap={2}>
                <Text fontSize={12} type={'secondary'}>
                  {t('pageEditor.review.check.rule')}
                </Text>
                <Text fontSize={12} style={{ lineHeight: 1.6 }} type={'secondary'}>
                  {rule.instruction}
                </Text>
              </Flexbox>
            )}

            {result?.explanation && (
              <Flexbox gap={2}>
                <Text fontSize={12} type={'secondary'}>
                  {t('pageEditor.review.check.explanation')}
                </Text>
                <Text fontSize={12} style={{ lineHeight: 1.6 }} type={'secondary'}>
                  {result.explanation}
                </Text>
              </Flexbox>
            )}

            {Boolean(result?.evidence?.length) && (
              <Flexbox gap={2}>
                <Text fontSize={12} type={'secondary'}>
                  {t('pageEditor.review.check.evidence')}
                </Text>
                {result!.evidence!.map((anchor, index) => (
                  <ReviewQuote
                    anchor={anchor}
                    key={`${anchor.quote}-${index}`}
                    label={anchor.label || t('pageEditor.review.check.evidence')}
                    onJump={() => onJump(anchor)}
                  />
                ))}
              </Flexbox>
            )}

            {status === 'needs_recheck' && (
              <Flexbox gap={6}>
                <Text fontSize={12} type={'secondary'}>
                  {result?.appliedAt
                    ? t('pageEditor.review.check.applied')
                    : t('pageEditor.review.check.needsRecheck')}
                </Text>
                {canWrite && (
                  <Button
                    icon={RefreshCwIcon}
                    loading={pendingAction === 'recheck'}
                    size={'small'}
                    type={'primary'}
                    onClick={() => result && onRecheck(result.id)}
                  >
                    {pendingAction === 'recheck'
                      ? t('pageEditor.review.action.rechecking')
                      : t('pageEditor.review.action.recheck')}
                  </Button>
                )}
              </Flexbox>
            )}

            {showSuggestion && result && (
              <Flexbox gap={6}>
                <Flexbox horizontal align={'center'} gap={6}>
                  <Text fontSize={12} style={{ flex: 1 }} type={'secondary'}>
                    {t('pageEditor.review.check.suggestion')}
                  </Text>
                  {canWrite && !result.suggestion && (
                    <Button
                      loading={pendingAction === 'suggestFix'}
                      size={'small'}
                      type={'text'}
                      onClick={() => onSuggest(result.id)}
                    >
                      {pendingAction === 'suggestFix'
                        ? t('pageEditor.review.action.suggesting')
                        : t('pageEditor.review.action.suggestFix')}
                    </Button>
                  )}
                </Flexbox>

                {result.suggestion ? (
                  <>
                    {result.suggestion.original && (
                      <Text
                        fontSize={12}
                        style={{
                          paddingInline: 8,
                          textDecoration: 'line-through',
                          color: cssVar.colorTextTertiary,
                        }}
                      >
                        {result.suggestion.original}
                      </Text>
                    )}
                    <TextArea
                      autoSize={{ maxRows: 6, minRows: 2 }}
                      disabled={!canWrite}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    {canWrite && (
                      <Flexbox horizontal gap={4}>
                        <Button
                          disabled={!canApply}
                          loading={pendingAction === 'applySuggestion'}
                          size={'small'}
                          type={'primary'}
                          onClick={() => result && onApply(result.id, draft)}
                        >
                          {pendingAction === 'applySuggestion'
                            ? t('pageEditor.review.action.applying')
                            : t('pageEditor.review.action.apply')}
                        </Button>
                        <Button
                          disabled={isBusy}
                          size={'small'}
                          type={'text'}
                          onClick={() => onSuggest(result.id)}
                        >
                          {t('pageEditor.review.action.regenerateSuggestion')}
                        </Button>
                      </Flexbox>
                    )}
                  </>
                ) : (
                  <Text fontSize={12} type={'secondary'}>
                    {t('pageEditor.review.check.noSuggestion')}
                  </Text>
                )}
              </Flexbox>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

RuleChecklistItem.displayName = 'ReviewRuleChecklistItem';

export default RuleChecklistItem;

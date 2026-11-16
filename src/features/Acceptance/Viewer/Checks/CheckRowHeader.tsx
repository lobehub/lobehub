import {
  ActionIcon,
  copyToClipboard,
  cssVar,
  Flexbox,
  Icon,
  Tag,
  Text,
  Tooltip,
} from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { Ban, Check, ChevronRight, MessageSquareX } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import type { readVisualizationManifest } from '../../Report/visualization';
import type { evidenceCounts } from '../Evidence/evidence';
import { rowHeaderMarker } from '../markers.stylex';
import type { CheckDecision } from './checkDecision';
import { CheckRowMeta } from './CheckRowMeta';
import { styles } from './styles';
import type { AcceptanceCheck } from './types';
import type { CheckReviewActions } from './useCheckReviewActions';

const QuickActions = memo<{ review: CheckReviewActions; reviewPending: boolean }>(
  ({ review, reviewPending }) => {
    const { t } = useTranslation('verify');
    const { accepting, handleAccept, handleIgnore, ignoring, openReject } = review;

    return (
      <Flexbox
        horizontal
        align={'center'}
        // A running accept/ignore spinner stays visible after the pointer leaves.
        data-busy={accepting || ignoring ? '' : undefined}
        gap={2}
        {...sx(styles.rowActions, !(accepting || ignoring) && styles.rowActionsIdle, {
          flex: 'none',
        })}
      >
        <ActionIcon
          disabled={reviewPending && !accepting}
          icon={Check}
          loading={accepting}
          size={'small'}
          title={t('acceptance.review.accept')}
          onClick={handleAccept}
        />
        <ActionIcon
          disabled={reviewPending && !ignoring}
          icon={Ban}
          loading={ignoring}
          size={'small'}
          title={t('acceptance.review.ignore')}
          onClick={handleIgnore}
        />
        <ActionIcon
          disabled={reviewPending}
          icon={MessageSquareX}
          size={'small'}
          title={t('acceptance.review.reject')}
          onClick={(event) => {
            event.stopPropagation();
            openReject();
          }}
        />
      </Flexbox>
    );
  },
);

QuickActions.displayName = 'AcceptanceCheckRowQuickActions';

interface CheckRowHeaderProps {
  activate: () => void;
  ariaExpanded?: boolean;
  check: AcceptanceCheck;
  checkThreadCount: number;
  counts: ReturnType<typeof evidenceCounts>;
  decision: CheckDecision;
  desktop: boolean;
  headColor: string;
  headIcon: LucideIcon;
  onRound?: (round: number) => void;
  open: boolean;
  review: CheckReviewActions;
  reviewPending: boolean;
  showQuickActions: boolean;
  title: string;
  verdictLabel: string;
  visualization: ReturnType<typeof readVisualizationManifest>;
  waived: boolean;
}

export const CheckRowHeader = memo<CheckRowHeaderProps>(
  ({
    activate,
    ariaExpanded,
    check,
    checkThreadCount,
    counts,
    decision,
    desktop,
    headColor,
    headIcon,
    onRound,
    open,
    review,
    reviewPending,
    showQuickActions,
    title,
    verdictLabel,
    visualization,
    waived,
  }) => {
    const { t } = useTranslation('verify');
    const [seqCopied, setSeqCopied] = useState(false);

    return (
      <Flexbox
        horizontal
        align={'flex-start'}
        aria-expanded={ariaExpanded}
        data-expanded={open ? '' : undefined}
        gap={10}
        role={'button'}
        tabIndex={0}
        {...stylex.props(styles.rowHeader, !open && styles.rowHeaderCollapsed, rowHeaderMarker)}
        onClick={activate}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            (event.key === 'Enter' || event.key === ' ')
          ) {
            event.preventDefault();
            activate();
          }
        }}
      >
        <Tooltip title={verdictLabel}>
          <Icon
            color={headColor}
            icon={headIcon}
            size={16}
            style={{ alignSelf: 'flex-start', flex: 'none', marginBlockStart: 3 }}
          />
        </Tooltip>
        <Tooltip title={seqCopied ? t('acceptance.checks.copied') : t('acceptance.checks.copySeq')}>
          <span
            {...stylex.props(styles.seqChip, styles.seqChipClickable)}
            onClick={(event) => {
              event.stopPropagation();
              void copyToClipboard(`C${check.seq}`);
              setSeqCopied(true);
              setTimeout(() => setSeqCopied(false), 1500);
            }}
          >
            C{check.seq}
          </span>
        </Tooltip>
        <Flexbox
          horizontal
          align={'center'}
          {...sx(styles.rowTitle, { minWidth: 0 })}
          flex={1}
          gap={8}
          wrap={open ? 'wrap' : 'nowrap'}
        >
          <Text
            {...sx(
              open || !desktop ? null : styles.titleEllipsis,
              decision === 'accepted' || decision === 'ignored' ? styles.titleSettled : null,
              { fontSize: 14, minWidth: 0 },
            )}
          >
            {title}
          </Text>
          {!check.required && (
            <Tooltip title={t('acceptance.checks.notRequiredHint')}>
              <Tag size={'small'}>{t('acceptance.checks.notRequired')}</Tag>
            </Tooltip>
          )}
          {waived && (
            <Tooltip title={t('acceptance.checks.waivedHint')}>
              <Tag size={'small'}>{t('acceptance.checks.waived')}</Tag>
            </Tooltip>
          )}
          {/* The verdict pair travels WITH the title, not adrift at the row's
          far right: the claim you judge and the judgement you give land in
          one glance, so a long checklist needs no eye round-trip across the
          row (and no mis-click onto a neighbour's buttons). */}
          {showQuickActions && <QuickActions review={review} reviewPending={reviewPending} />}
        </Flexbox>
        <CheckRowMeta
          check={check}
          checkThreadCount={checkThreadCount}
          counts={counts}
          decision={decision}
          visualization={visualization}
          onRound={onRound}
        />
        <Flexbox
          align={'center'}
          height={22}
          justify={'center'}
          {...stylex.props(styles.rowChevron)}
        >
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={ChevronRight}
            size={14}
            style={{
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.2s',
            }}
          />
        </Flexbox>
      </Flexbox>
    );
  },
);

CheckRowHeader.displayName = 'AcceptanceCheckRowHeader';

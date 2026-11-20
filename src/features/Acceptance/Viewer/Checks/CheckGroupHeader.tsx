import { ActionIcon, Button, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  MessageSquareText,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import DecisionStrip from '../Review/DecisionStrip';
import { decisionSegments } from './checkDecision';
import { isException, isGroupFullyAccepted, userReviewState } from './checkState';
import type { AcceptanceCheck } from './types';

const phone = '@media (width <= 767px)';

const styles = stylex.create({
  header: {
    cursor: 'pointer',
    display: 'flex',
    flexWrap: { default: null, [phone]: 'wrap' },
    gap: '8px',
    alignItems: 'center',
    minHeight: '44px',
    paddingBlock: '8px',
    paddingInline: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: { 'default': 'solid', ':first-child': 'none' },
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  toggle: {
    cursor: 'pointer',
    display: 'flex',
    gap: '8px',
    flexBasis: { default: null, [phone]: '100%' },
    alignItems: 'center',
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderColor: 'currentcolor',
    borderRadius: '4px',
    font: 'inherit',
    textAlign: 'start',
    appearance: 'none',
    backgroundColor: 'transparent',
    outlineWidth: { 'default': 0, ':focus-visible': '2px' },
    outlineStyle: { 'default': 'none', ':focus-visible': 'solid' },
    outlineColor: cssVar.colorPrimary,
    outlineOffset: '2px',
  },
  label: {
    overflow: 'hidden',
    minWidth: 0,
    fontSize: '14px',
    fontWeight: 600,
    lineHeight: '22px',
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  strip: {
    flex: 'none',
    width: '64px',
  },
  stat: {
    flex: 'none',
    fontSize: '12px',
    lineHeight: '20px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
  statError: { color: cssVar.colorErrorText },
  statDone: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    color: cssVar.colorSuccessText,
  },
  spacer: { flex: '1' },
});

interface CheckGroupHeaderProps {
  accepting: boolean;
  anyItemOpen: boolean;
  canReview: boolean;
  checks: AcceptanceCheck[];
  collapsed: boolean;
  label: string;
  onAcceptAll: (ids: string[]) => void;
  onFeedback: () => void;
  onToggle: () => void;
  onToggleItems?: () => void;
  reviewPending: boolean;
}

const CheckGroupHeader = memo<CheckGroupHeaderProps>(
  ({
    accepting,
    anyItemOpen,
    canReview,
    checks,
    collapsed,
    label,
    onAcceptAll,
    onFeedback,
    onToggle,
    onToggleItems,
    reviewPending,
  }) => {
    const { t } = useTranslation('verify');
    const reviewable = checks.filter((check) => check.result);
    const countReview = (state: ReturnType<typeof userReviewState>) =>
      reviewable.filter((check) => userReviewState(check) === state).length;
    const acceptedCount = countReview('accepted');
    const rejectedCount = countReview('rejected');
    const ignoredCount = countReview('ignored');
    const unaccepted = reviewable.filter(
      (check) => !['accepted', 'ignored'].includes(userReviewState(check)),
    );
    const exceptionCount = checks.filter((check) => isException(check)).length;
    const passed = checks.filter((check) => check.state === 'passed').length;
    const allVerified = passed === checks.length && isGroupFullyAccepted(checks);

    return (
      <div {...stylex.props(styles.header)} onClick={onToggle}>
        <button
          aria-expanded={!collapsed}
          type={'button'}
          {...stylex.props(styles.toggle)}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={collapsed ? ChevronRight : ChevronDown}
            size={14}
          />
          <span {...stylex.props(styles.label)}>{label}</span>
        </button>
        <DecisionStrip
          label={t('acceptance.bar.stripLabel', { accepted: acceptedCount, total: checks.length })}
          segments={decisionSegments(checks)}
          xstyle={styles.strip}
        />
        {allVerified ? (
          <span {...stylex.props(styles.stat, styles.statDone)}>
            <Icon icon={BadgeCheck} size={14} />
            {t('acceptance.group.allVerified', { passed, total: checks.length })}
          </span>
        ) : (
          <>
            <span {...stylex.props(styles.stat)}>
              {t('acceptance.group.acceptedRatio', {
                accepted: acceptedCount,
                total: checks.length,
              })}
            </span>
            {exceptionCount > 0 && (
              <span {...stylex.props(styles.stat, styles.statError)}>
                {t('acceptance.group.failedCount', { count: exceptionCount })}
              </span>
            )}
            {rejectedCount > 0 && (
              <span {...stylex.props(styles.stat, styles.statError)}>
                {t('acceptance.group.rejectedCount', { count: rejectedCount })}
              </span>
            )}
            {ignoredCount > 0 && (
              <span {...stylex.props(styles.stat)}>
                {t('acceptance.group.ignoredCount', { count: ignoredCount })}
              </span>
            )}
          </>
        )}
        <span {...stylex.props(styles.spacer)} />
        {canReview && unaccepted.length > 0 && (
          <Button
            disabled={reviewPending && !accepting}
            icon={<Icon icon={BadgeCheck} />}
            loading={accepting}
            size={'small'}
            onClick={(event) => {
              event.stopPropagation();
              onAcceptAll(unaccepted.map((check) => check.id));
            }}
          >
            {t('acceptance.review.acceptAll')}
          </Button>
        )}
        {canReview && (
          <ActionIcon
            icon={MessageSquareText}
            size={'small'}
            title={t('acceptance.group.feedbackAction')}
            onClick={(event) => {
              event.stopPropagation();
              onFeedback();
            }}
          />
        )}
        {!collapsed && onToggleItems && (
          <ActionIcon
            icon={anyItemOpen ? ChevronsDownUp : ChevronsUpDown}
            size={'small'}
            title={
              anyItemOpen ? t('acceptance.group.collapseItems') : t('acceptance.group.expandItems')
            }
            onClick={(event) => {
              event.stopPropagation();
              onToggleItems();
            }}
          />
        )}
      </div>
    );
  },
);

CheckGroupHeader.displayName = 'AcceptanceCheckGroupHeader';

export default CheckGroupHeader;

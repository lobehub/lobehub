'use client';

import type { AcceptanceGroupFeedback } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Fragment, memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { hasVisualEvidence } from '../Evidence/evidence';
import { openGroupFeedbackModal } from '../Review/modals';
import { decisionSections } from './checkDecision';
import CheckGroupHeader from './CheckGroupHeader';
import { AcceptanceCheckRow } from './CheckRow';
import type { CheckFilter } from './checkState';
import {
  checkFilterState,
  groupChecks,
  isGroupFullyAccepted,
  SEVERITY,
  shouldGroupChecks,
  userReviewState,
} from './checkState';
import { GroupFeedbackTrail } from './GroupFeedbackTrail';
import { styles } from './styles';
import type { AcceptanceCheck, CheckReviewInput, ProposalDismissInput } from './types';

interface CheckListProps {
  /** Whether the viewer may review checks (the aggregate's owner). */
  canReview: boolean;
  checks: AcceptanceCheck[];
  collapsedGroups: Set<string>;
  /** The latest round index — arbitrates group-feedback staleness. */
  currentRound: number;
  expanded: Set<string>;
  filter: CheckFilter;
  /** Group-scoped feedback entries recorded on the aggregate. */
  groupFeedback: AcceptanceGroupFeedback[];
  /** Answer a model proposal without ruling on the check itself. */
  onDismissProposal?: (input: ProposalDismissInput) => Promise<void>;
  /** Record group-scoped feedback; resolves true when the write landed. */
  onGroupFeedback: (category: string, comment: string, fileIds: string[]) => Promise<boolean>;
  /**
   * Open a check on its own page instead of unfolding it in the list. Set on a
   * phone, where the inline disclosure buries its neighbours.
   */
  onOpenCheck?: (id: string) => void;
  /** Open an agent judge's verification run (its trace IS the argument). */
  onOpenTrace?: (verifierOperationId: string) => void | Promise<void>;
  /** Record the user's verdict; resolves true when the write landed. */
  onReview: (input: CheckReviewInput) => Promise<boolean>;
  onRound?: (round: number) => void;
  onShowAll?: () => void;
  onToggleGroup: (key: string) => void;
  onToggleGroupItems: (ids: string[], open: boolean) => void;
  onToggleItem: (id: string) => void;
  reviewPending: boolean;
}

/** The union check list: one joined card, collapsible business groups. */
const CheckList = memo<CheckListProps>(
  ({
    canReview,
    checks,
    collapsedGroups,
    currentRound,
    expanded,
    filter,
    groupFeedback,
    onDismissProposal,
    onGroupFeedback,
    onOpenCheck,
    onReview,
    onOpenTrace,
    onRound,
    onShowAll,
    onToggleGroup,
    onToggleGroupItems,
    onToggleItem,
    reviewPending,
  }) => {
    const { t } = useTranslation('verify');
    const [acceptingGroup, setAcceptingGroup] = useState<string | null>(null);

    const visible = (check: AcceptanceCheck) =>
      filter === 'all' || checkFilterState(check) === filter;

    const visibleRows = checks
      .filter(visible)
      .sort(
        (a, b) =>
          SEVERITY[a.state] - SEVERITY[b.state] ||
          (hasVisualEvidence(b) ? 1 : 0) - (hasVisualEvidence(a) ? 1 : 0) ||
          a.introducedAtRound - b.introducedAtRound,
      );
    const groups = groupChecks(checks, t('acceptance.group.uncategorized'))
      .map((group) => ({
        ...group,
        rows: group.checks
          .filter(visible)
          .sort(
            (a, b) =>
              SEVERITY[a.state] - SEVERITY[b.state] ||
              (hasVisualEvidence(b) ? 1 : 0) - (hasVisualEvidence(a) ? 1 : 0) ||
              a.introducedAtRound - b.introducedAtRound,
          ),
      }))
      .filter((group) => group.rows.length > 0);

    if (visibleRows.length === 0) {
      // An empty pending bucket where every check is signed off is the finish
      // line, not "nothing here".
      const allAccepted = filter === 'pending' && isGroupFullyAccepted(checks);
      const emptyKey =
        filter === 'all'
          ? ('acceptance.checks.empty' as const)
          : (`acceptance.checks.emptyFilter.${filter}` as const);
      return (
        <div {...stylex.props(styles.emptyState)}>
          <span {...stylex.props(styles.emptyTitle)}>
            {allAccepted ? t('acceptance.checks.allAccepted.title') : t(emptyKey)}
          </span>
          {allAccepted && (
            <span {...stylex.props(styles.emptyDesc)}>
              {t('acceptance.checks.allAccepted.desc')}
            </span>
          )}
          {filter !== 'all' && checks.length > 0 && onShowAll && (
            <Button onClick={onShowAll}>
              {t('acceptance.checks.showAll', { count: checks.length })}
            </Button>
          )}
        </div>
      );
    }

    if (!shouldGroupChecks(checks.length)) {
      const sections = filter === 'all' ? decisionSections(visibleRows) : [];
      const renderRow = (check: AcceptanceCheck) => (
        <AcceptanceCheckRow
          canReview={canReview}
          check={check}
          expanded={expanded.has(check.id)}
          key={check.id}
          reviewPending={reviewPending}
          onDismissProposal={onDismissProposal}
          onOpenDetail={onOpenCheck ? () => onOpenCheck(check.id) : undefined}
          onOpenTrace={onOpenTrace}
          onReview={onReview}
          onRound={onRound}
          onToggle={() => onToggleItem(check.id)}
        />
      );
      return (
        <Flexbox {...stylex.props(styles.groupCard)}>
          {sections.length > 1
            ? sections.map((section) => (
                <Fragment key={section.key}>
                  <div {...stylex.props(styles.sectionHeader)}>
                    {t(`acceptance.focus.state.${section.key}`)}
                    <span {...stylex.props(styles.sectionCount)}>{section.checks.length}</span>
                  </div>
                  <div>{section.checks.map(renderRow)}</div>
                </Fragment>
              ))
            : visibleRows.map(renderRow)}
        </Flexbox>
      );
    }

    return (
      <Flexbox {...stylex.props(styles.groupCard)}>
        {groups.map(({ checks: groupChecks_, key, label, rows }) => {
          const collapsed = collapsedGroups.has(key);
          const anyItemOpen = rows.some((check) => expanded.has(check.id));
          // Group-scoped feedback targets the raw category ('' = uncategorized).
          const rawCategory = key === 'uncategorized' ? '' : label;
          const feedbackEntries = groupFeedback.filter((entry) => entry.category === rawCategory);

          return (
            <Fragment key={key}>
              <CheckGroupHeader
                accepting={acceptingGroup === key}
                anyItemOpen={anyItemOpen}
                canReview={canReview}
                checks={groupChecks_}
                collapsed={collapsed}
                label={label}
                reviewPending={reviewPending}
                onToggle={() => onToggleGroup(key)}
                onAcceptAll={async (checkItemIds) => {
                  setAcceptingGroup(key);
                  const ok = await onReview({ action: 'accept', checkItemIds });
                  setAcceptingGroup(null);
                  // A fully signed-off group is settled business — fold it.
                  if (ok && !collapsed) onToggleGroup(key);
                }}
                onFeedback={() =>
                  openGroupFeedbackModal({
                    groupLabel: label,
                    onConfirm: (comment, fileIds) => onGroupFeedback(rawCategory, comment, fileIds),
                  })
                }
                // Expanding a group is "show me what still needs judgment" —
                // rows the user already accepted stay folded. Collapsing folds
                // everything, accepted or not.
                onToggleItems={
                  onOpenCheck
                    ? undefined
                    : () =>
                        onToggleGroupItems(
                          anyItemOpen
                            ? rows.map((check) => check.id)
                            : rows
                                .filter((check) => userReviewState(check) !== 'accepted')
                                .map((check) => check.id),
                          !anyItemOpen,
                        )
                }
              />
              {/* Group feedback trail — newest first; entries consumed by a
                  later round stay readable but visually recede. */}
              {!collapsed && (
                <GroupFeedbackTrail currentRound={currentRound} entries={feedbackEntries} />
              )}
              {!collapsed &&
                rows.map((check) => (
                  <AcceptanceCheckRow
                    canReview={canReview}
                    check={check}
                    expanded={expanded.has(check.id)}
                    key={check.id}
                    reviewPending={reviewPending}
                    onDismissProposal={onDismissProposal}
                    onOpenDetail={onOpenCheck ? () => onOpenCheck(check.id) : undefined}
                    onOpenTrace={onOpenTrace}
                    onReview={onReview}
                    onRound={onRound}
                    onToggle={() => onToggleItem(check.id)}
                  />
                ))}
            </Fragment>
          );
        })}
      </Flexbox>
    );
  },
);

CheckList.displayName = 'AcceptanceCheckList';

export default CheckList;

'use client';

import { ActionIcon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRightIcon, FoldVerticalIcon, UnfoldVerticalIcon } from 'lucide-react';
import { type KeyboardEvent, memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Sticky group header — appears once per repo (parent + each dirty submodule)
  // when the working tree spans multiple repositories. Mirrors WebStorm's
  // per-repo grouping: collapse chevron + name + file count + totals + branch
  // all left-aligned. Position: sticky keeps the header pinned while scrolling
  // within its group's rows. The whole header is a button — click anywhere to
  // collapse/expand the group's rows. Top-only border (no bottom border) so
  // collapsing a group can't produce a doubled-up line against the next
  // header's top border.
  header: css`
    cursor: pointer;
    user-select: none;

    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    /* Fixed height accommodates the ActionIcon (size='small' is ~24px tall)
       so the header stays the same size whether or not the fold button is
       rendered. Without this, expanding/collapsing a group would jitter the
       sticky header height because the button toggles between rendered and
       not. flex:none keeps the column flex list from compressing the sticky
       header during expand/collapse. padding-inline keeps the left-edge
       alignment with file rows. */
    block-size: 32px;
    padding-inline: 10px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};

    transition: background 0.12s;

    /* Separate non-first groups from the preceding group's last row.
       The first header sits against the list's own top border. */
    &:not(:first-child) {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  chevron: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};
    transition: transform 0.2s;

    &[data-expanded='true'] {
      transform: rotate(90deg);
    }
  `,
  meta: css`
    overflow: hidden;
    display: inline-flex;
    flex: 1 1 auto;
    gap: 6px;
    align-items: center;

    min-width: 0;
  `,
  name: css`
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 0;

    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  fileCount: css`
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  stats: css`
    display: inline-flex;
    flex-shrink: 0;
    gap: 6px;
    align-items: center;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  `,
  additions: css`
    color: ${cssVar.colorSuccess};
  `,
  deletions: css`
    color: ${cssVar.colorError};
  `,
  branch: css`
    overflow: hidden;
    flex: 0 1 auto;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  // Hover-revealed fold-all-diffs button. Uses the standard ActionIcon, so
  // hover/focus visuals match the rest of the panel — we just gate visibility
  // via opacity bound to the parent header's hover/focus-within state.
  foldButton: css`
    margin-inline-start: auto;
    opacity: 0;
    transition: opacity 0.15s;

    [data-review-group-header]:hover &,
    [data-review-group-header]:focus-within & {
      opacity: 1;
    }
  `,
}));

export interface GroupHeaderProps {
  branch?: string;
  collapsed: boolean;
  /** True iff every file diff in the group is currently expanded — drives
   * the fold-button's icon + label. */
  diffsAllExpanded: boolean;
  /** Suppress the fold-all-diffs button (collapsed groups, empty groups). */
  hideFoldButton?: boolean;
  name: string;
  onToggleCollapsed: () => void;
  onToggleDiffs: () => void;
  patchCount: number;
  totalAdditions: number;
  totalDeletions: number;
}

const GroupHeader = memo<GroupHeaderProps>(
  ({
    branch,
    collapsed,
    diffsAllExpanded,
    hideFoldButton,
    name,
    onToggleCollapsed,
    onToggleDiffs,
    patchCount,
    totalAdditions,
    totalDeletions,
  }) => {
    const { t } = useTranslation('chat');
    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleCollapsed();
        }
      },
      [onToggleCollapsed],
    );
    const handleFoldClick = useCallback(
      (e: MouseEvent) => {
        e.stopPropagation();
        onToggleDiffs();
      },
      [onToggleDiffs],
    );
    const foldLabel = diffsAllExpanded
      ? t('workingPanel.review.group.collapseDiffs')
      : t('workingPanel.review.group.expandDiffs');
    return (
      <div
        aria-expanded={!collapsed}
        className={styles.header}
        data-review-group-header={''}
        role={'button'}
        tabIndex={0}
        onClick={onToggleCollapsed}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.meta}>
          <ChevronRightIcon
            className={styles.chevron}
            data-expanded={collapsed ? 'false' : 'true'}
            size={14}
          />
          <span className={styles.name}>{name}</span>
          <span className={styles.fileCount}>
            {t('workingPanel.review.group.fileCount', { count: patchCount })}
          </span>
          {(totalAdditions > 0 || totalDeletions > 0) && (
            <span className={styles.stats}>
              {totalAdditions > 0 && <span className={styles.additions}>+{totalAdditions}</span>}
              {totalDeletions > 0 && <span className={styles.deletions}>-{totalDeletions}</span>}
            </span>
          )}
          {branch && (
            <span className={styles.branch} title={branch}>
              {branch}
            </span>
          )}
        </div>
        {!hideFoldButton && (
          <ActionIcon
            aria-label={foldLabel}
            aria-pressed={diffsAllExpanded}
            className={styles.foldButton}
            icon={diffsAllExpanded ? FoldVerticalIcon : UnfoldVerticalIcon}
            size={'small'}
            title={foldLabel}
            onClick={handleFoldClick}
          />
        )}
      </div>
    );
  },
);

GroupHeader.displayName = 'AgentWorkingSidebarReviewGroupHeader';

export default GroupHeader;

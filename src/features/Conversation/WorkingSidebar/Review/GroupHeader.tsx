'use client';

import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRightIcon, FoldVerticalIcon, UnfoldVerticalIcon } from 'lucide-react';
import { type KeyboardEvent, memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  // Sticky group header — appears once per repo (parent + each dirty submodule)
  // when the working tree spans multiple repositories. Mirrors WebStorm's
  // per-repo grouping: collapse chevron + name + file count + totals + branch
  // all left-aligned. Position: sticky keeps the header pinned while scrolling
  // within its group's rows. The whole header is a button — click anywhere to
  // collapse/expand the group's rows. Top-only border (no bottom border) so
  // collapsing a group can't produce a doubled-up line against the next
  // header's top border.
  header: {
    cursor: 'pointer',
    userSelect: 'none',
    position: 'sticky',
    zIndex: 1,
    insetBlockStart: 0,
    display: 'flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    // Fixed height accommodates the ActionIcon (size='small' is ~24px tall)
    // so the header stays the same size whether or not the fold button is
    // rendered. Without this, expanding/collapsing a group would jitter the
    // sticky header height because the button toggles between rendered and
    // not. flex:none keeps the column flex list from compressing the sticky
    // header during expand/collapse. padding-inline keeps the left-edge
    // alignment with file rows.
    blockSize: '32px',
    paddingInline: '10px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    transition: 'background 0.12s',
    backgroundColor: { 'default': cssVar.colorFillQuaternary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    // Separate non-first groups from the preceding group's last row.
    // The first header sits against the list's own top border.
    borderBlockStartWidth: { 'default': null, ':not(:first-child)': '1px' },
    borderBlockStartStyle: { 'default': null, ':not(:first-child)': 'solid' },
    borderBlockStartColor: { 'default': null, ':not(:first-child)': cssVar.colorBorderSecondary },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
  chevron: {
    flex: 'none',
    color: cssVar.colorTextTertiary,
    transition: 'transform 0.2s',
    transform: { 'default': null, "[data-expanded='true']": 'rotate(90deg)' },
  },
  meta: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: 'auto',
    gap: '6px',
    alignItems: 'center',
    minWidth: 0,
  },
  name: {
    overflow: 'hidden',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: 0,
    fontWeight: 600,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileCount: {
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorTextTertiary,
  },
  stats: {
    display: 'inline-flex',
    flexShrink: 0,
    gap: '6px',
    alignItems: 'center',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    fontVariantNumeric: 'tabular-nums',
  },
  additions: { color: cssVar.colorSuccess },
  deletions: { color: cssVar.colorError },
  branch: {
    overflow: 'hidden',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: 0,
    fontFamily: cssVar.fontFamilyCode,
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Hover-revealed fold-all-diffs button. Uses the standard ActionIcon, so
  // hover/focus visuals match the rest of the panel — we just gate visibility
  // via opacity bound to the parent header's hover/focus-within state.
  foldButton: {
    marginInlineStart: 'auto',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
    },
    transition: 'opacity 0.15s',
  },
});

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
        {...stylex.props(styles.header, stylex.defaultMarker())}
        data-review-group-header={''}
        role={'button'}
        tabIndex={0}
        onClick={onToggleCollapsed}
        onKeyDown={handleKeyDown}
      >
        <div {...stylex.props(styles.meta)}>
          <ChevronRightIcon
            {...stylex.props(styles.chevron)}
            data-expanded={collapsed ? 'false' : 'true'}
            size={14}
          />
          <span {...stylex.props(styles.name)}>{name}</span>
          <span {...stylex.props(styles.fileCount)}>
            {t('workingPanel.review.group.fileCount', { count: patchCount })}
          </span>
          {(totalAdditions > 0 || totalDeletions > 0) && (
            <span {...stylex.props(styles.stats)}>
              {totalAdditions > 0 && (
                <span {...stylex.props(styles.additions)}>+{totalAdditions}</span>
              )}
              {totalDeletions > 0 && (
                <span {...stylex.props(styles.deletions)}>-{totalDeletions}</span>
              )}
            </span>
          )}
          {branch && (
            <span {...stylex.props(styles.branch)} title={branch}>
              {branch}
            </span>
          )}
        </div>
        {!hideFoldButton && (
          <ActionIcon
            aria-label={foldLabel}
            aria-pressed={diffsAllExpanded}
            {...stylex.props(styles.foldButton)}
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

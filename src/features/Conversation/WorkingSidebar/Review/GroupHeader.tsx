'use client';

import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, FoldVerticalIcon, UnfoldVerticalIcon } from 'lucide-react';
import { type KeyboardEvent, memo, type MouseEvent, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { sidebarRow } from '@/styles/density.stylex';

import { reviewGroupHeaderMarker } from './markers.stylex';

const styles = stylex.create({
  // Sticky group header, once per repo (parent + each dirty submodule) when the
  // working tree spans several repositories. Sticky keeps it pinned while its
  // group's rows scroll, so it needs an opaque fill. The whole header is a
  // button: click anywhere to collapse/expand the group's rows. The fixed
  // height fits the fold ActionIcon, so the header does not jitter when that
  // button toggles between rendered and not.
  header: {
    cursor: 'pointer',
    userSelect: 'none',
    position: 'sticky',
    zIndex: 1,
    insetBlockStart: 0,
    display: 'flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    blockSize: sidebarRow.sectionHeaderHeight,
    paddingInlineStart: sidebarRow.paddingInline,
    paddingInlineEnd: sidebarRow.paddingInline,
    fontSize: sidebarRow.labelFontSize,
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    marginBlockStart: { 'default': null, ':not(:first-child)': sidebarRow.sectionGap },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '-2px' },
  },
  chevron: {
    flex: 'none',
    color: cssVar.colorTextTertiary,
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', reviewGroupHeaderMarker)]: 1,
      [stylex.when.ancestor(':focus-visible', reviewGroupHeaderMarker)]: 1,
    },
    transition: 'opacity 0.15s, transform 0.15s',
  },
  chevronCollapsed: { opacity: 1, transform: 'rotate(-90deg)' },
  meta: {
    overflow: 'hidden',
    display: 'inline-flex',
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: 'auto',
    gap: '4px',
    alignItems: 'center',
    minWidth: 0,
  },
  name: {
    overflow: 'hidden',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: 0,
    fontWeight: sidebarRow.labelFontWeight,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileCount: {
    flexShrink: 0,
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
  },
  stats: {
    display: 'inline-flex',
    flexShrink: 0,
    gap: '6px',
    alignItems: 'center',
    marginInlineStart: '2px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: sidebarRow.metaFontSize,
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
    marginInlineStart: '2px',
    fontFamily: cssVar.fontFamilyCode,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  foldButton: {
    marginInlineStart: 'auto',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', reviewGroupHeaderMarker)]: 1,
      [stylex.when.ancestor(':focus-within', reviewGroupHeaderMarker)]: 1,
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
        {...stylex.props(styles.header, reviewGroupHeaderMarker)}
        data-review-group-header={''}
        role={'button'}
        tabIndex={0}
        onClick={onToggleCollapsed}
        onKeyDown={handleKeyDown}
      >
        <div {...stylex.props(styles.meta)}>
          <span {...stylex.props(styles.name)}>{name}</span>
          <span {...stylex.props(styles.fileCount)}>
            {t('workingPanel.review.group.fileCount', { count: patchCount })}
          </span>
          <ChevronDownIcon
            {...stylex.props(styles.chevron, collapsed && styles.chevronCollapsed)}
            size={12}
          />
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

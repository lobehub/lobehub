'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';

import {
  ExplorerTree,
  FOLDER_ICON_CSS,
  getExplorerTreeStyleVars,
  HIDE_POINTER_FOCUS_RING_CSS,
} from '@/features/ExplorerTree';
import { useDensityTokens } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';

import { COMPACT_FOLDER_ICON_CSS } from '../Files/fileTreeStyle';
import { buildReviewTreeNodes, type ReviewTreeData, type ReviewTreeGroup } from './reviewTreeNodes';

const FILE_TREE_UNSAFE_CSS = [
  FOLDER_ICON_CSS,
  COMPACT_FOLDER_ICON_CSS,
  HIDE_POINTER_FOCUS_RING_CSS,
].join('\n');

const styles = stylex.create({
  tree: {
    '--trees-bg-override': 'transparent',
    '--trees-border-color-override': 'transparent',
    '--trees-selected-bg-override': cssVar.colorFillSecondary,
    '--trees-selected-fg-override': cssVar.colorText,
    '--trees-bg-muted-override': cssVar.colorFillTertiary,
    '--trees-fg-override': cssVar.colorTextSecondary,
    '--trees-fg-muted-override': cssVar.colorTextSecondary,
    '--trees-accent-override': cssVar.colorPrimary,
    '--trees-padding-inline-override': sidebarRow.paneInline,
    '--trees-item-margin-x-override': '0px',
    '--trees-item-padding-x-override': sidebarRow.paddingInline,
    '--trees-item-row-gap-override': sidebarRow.gap,
    '--trees-font-size-override': sidebarRow.textFontSize,
    '--trees-border-radius-override': sidebarRow.radius,
    'flex': '1',
    'minHeight': '0',
  },
});

interface FileTreeNavProps {
  /** itemKey of the file whose diff is currently focused — highlighted in the tree. */
  activeFileKey?: string;
  groups: ReviewTreeGroup[];
  /** Fired when a file leaf is clicked — the diff list scrolls to & expands it. */
  onSelectFile: (key: string) => void;
  showGroupHeaders: boolean;
}

/**
 * Navigation-only directory tree for the Review panel's right rail. Reuses the
 * Files-tab `ExplorerTree` so folder / file-type icons match exactly; clicking a
 * leaf scrolls the left diff list to that file's patch (no diff embedded here).
 */
const FileTreeNav = memo<FileTreeNavProps>(
  ({ activeFileKey, groups, onSelectFile, showGroupHeaders }) => {
    const density = useDensityTokens();
    const nodes = useMemo(
      () => buildReviewTreeNodes(groups, showGroupHeaders),
      [groups, showGroupHeaders],
    );
    // Folders start expanded so the full outline shows whenever the rail opens.
    const defaultExpandedIds = useMemo(
      () => nodes.filter((node) => node.isFolder).map((node) => node.id),
      [nodes],
    );
    const selectedIds = useMemo(
      () =>
        activeFileKey ? nodes.filter((n) => n.data?.key === activeFileKey).map((n) => n.id) : [],
      [nodes, activeFileKey],
    );
    const treeStyleVars = useMemo(
      () =>
        getExplorerTreeStyleVars({
          reserveChevronSlot: nodes.some((node) => node.isFolder),
          rowGap: density.gap,
        }),
      [density.gap, nodes],
    );

    return (
      <div className={stylex.props(styles.tree).className} style={treeStyleVars}>
        <ExplorerTree<ReviewTreeData>
          iconsColored
          defaultExpandedIds={defaultExpandedIds}
          iconSet="complete"
          itemHeight={density.treeItemHeight}
          nodes={nodes}
          selectedIds={selectedIds}
          style={{ height: '100%' }}
          unsafeCSS={FILE_TREE_UNSAFE_CSS}
          onNodeClick={(node) => {
            if (node.isFolder || !node.data) return;
            onSelectFile(node.data.key);
          }}
        />
      </div>
    );
  },
);

FileTreeNav.displayName = 'AgentWorkingSidebarReviewFileTreeNav';

export default FileTreeNav;

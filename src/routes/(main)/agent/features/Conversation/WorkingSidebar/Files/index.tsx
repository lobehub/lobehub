'use client';

import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { Center, copyToClipboard, Empty, Flexbox, SearchBar, stopPropagation } from '@lobehub/ui';
import type { MenuProps } from 'antd';
import { message } from 'antd';
import { createStaticStyles } from 'antd-style';
import { FileIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import type { ExplorerTreeNode } from '@/features/ExplorerTree';
import {
  ExplorerTree,
  FOLDER_ICON_CSS,
  getExplorerTreeStyleVars,
  HIDE_POINTER_FOCUS_RING_CSS,
} from '@/features/ExplorerTree';
import type { ExplorerTreeHandle } from '@/features/ExplorerTree/types';
import { localFileService } from '@/services/electron/localFileService';
import { projectFileService } from '@/services/projectFile';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

import { buildGitStatusEntries, useGitWorkingTreeFiles } from './useGitWorkingTreeFiles';
import { useProjectFiles } from './useProjectFiles';

interface FilesProps {
  /**
   * Target device the working directory lives on. Undefined for local desktop;
   * set for a remote / web-bound device so the tree + git status route through
   * the device RPCs. OS-level actions (open in app / reveal in Finder) are
   * hidden for remote — there's no local filesystem to act on.
   */
  deviceId?: string;
  workingDirectory: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  tree: css`
    --trees-bg-override: transparent;
    --trees-border-color-override: transparent;
    --trees-selected-bg-override: ${cssVar.colorFillSecondary};
    --trees-selected-fg-override: ${cssVar.colorText};
    --trees-bg-muted-override: ${cssVar.colorFillTertiary};
    --trees-fg-override: ${cssVar.colorTextSecondary};
    --trees-fg-muted-override: ${cssVar.colorTextSecondary};
    --trees-accent-override: ${cssVar.colorPrimary};
    --trees-padding-inline-override: 0px;
    --trees-font-size-override: 12px;
    --trees-border-radius-override: 6px;

    flex: 1;
    min-height: 0;
  `,
  subheader: css`
    flex-shrink: 0;
    padding-block: 6px 8px;
    padding-inline: 12px;
  `,
}));

const stripTrailingSlash = (value: string) => (value.endsWith('/') ? value.slice(0, -1) : value);

const FILE_TREE_UNSAFE_CSS = `${FOLDER_ICON_CSS}\n${HIDE_POINTER_FOCUS_RING_CSS}`;
const FILE_SEARCH_DEBOUNCE_MS = 180;
const PROJECT_FILE_TREE_SEARCH_LIMIT = 200;

const getParentRelativePath = (relativePath: string): string | null => {
  const cleaned = stripTrailingSlash(relativePath);
  const idx = cleaned.lastIndexOf('/');
  if (idx < 0) return null;
  return `${cleaned.slice(0, idx)}/`;
};

const buildTreeNodes = (
  entries: ProjectFileIndexEntry[],
): ExplorerTreeNode<ProjectFileIndexEntry>[] => {
  // The index gives every file plus the chain of containing directories, each
  // with a unique relativePath (directories end with "/"). Use that string as
  // the stable node id and derive parentId from the path itself.
  const ids = new Set(entries.map((entry) => entry.relativePath));
  return entries.map((entry) => {
    const parentRel = getParentRelativePath(entry.relativePath);
    const parentId = parentRel && ids.has(parentRel) ? parentRel : null;
    return {
      data: entry,
      id: entry.relativePath,
      isFolder: entry.isDirectory,
      name: entry.name,
      parentId,
    };
  });
};

const getAncestorIds = (filePath: string): string[] => {
  const segments = filePath.split('/');
  const ancestors: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join('/') + '/');
  }
  return ancestors;
};

const Files = memo<FilesProps>(({ deviceId, workingDirectory }) => {
  const { t } = useTranslation('chat');
  const isRemote = !!deviceId;
  const { data, isLoading } = useProjectFiles(deviceId, workingDirectory);
  const { data: gitFiles } = useGitWorkingTreeFiles(
    deviceId,
    workingDirectory,
    data?.source === 'git',
  );
  const projectRoot = data?.root ?? workingDirectory;

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchEntries, setSearchEntries] = useState<ProjectFileIndexEntry[] | undefined>();
  const [isSearching, setIsSearching] = useState(false);
  const normalizedDebouncedQuery = debouncedQuery.trim();
  const isFiltering = normalizedDebouncedQuery.length > 0;
  const displayEntries = useMemo(
    () => (isFiltering ? (searchEntries ?? []) : entries),
    [entries, isFiltering, searchEntries],
  );
  const nodes = useMemo(() => buildTreeNodes(displayEntries), [displayEntries]);
  const gitStatus = useMemo(() => buildGitStatusEntries(gitFiles), [gitFiles]);
  const dirtyFilePaths = useMemo(() => new Set(gitStatus.map((entry) => entry.path)), [gitStatus]);
  // Pre-expand top-level directories so the user sees something useful on first
  // paint without having to click through every folder.
  const defaultExpandedIds = useMemo(
    () =>
      nodes
        .filter((node) => node.isFolder && (isFiltering || node.parentId == null))
        .map((node) => node.id),
    [isFiltering, nodes],
  );
  const treeStyleVars = useMemo(
    () => getExplorerTreeStyleVars({ reserveChevronSlot: nodes.some((node) => node.isFolder) }),
    [nodes],
  );

  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), FILE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!normalizedDebouncedQuery) {
      setIsSearching(false);
      setSearchEntries(undefined);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    setSearchEntries(undefined);

    void projectFileService
      .searchProjectFiles({
        deviceId,
        limit: PROJECT_FILE_TREE_SEARCH_LIMIT,
        query: normalizedDebouncedQuery,
        scope: workingDirectory,
      })
      .then((result) => {
        if (cancelled) return;
        setSearchEntries(result?.entries ?? []);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[Files] Failed to search project files:', error);
        setSearchEntries([]);
      })
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [deviceId, normalizedDebouncedQuery, workingDirectory]);

  // Skip resyncs when defaultExpandedIds is structurally unchanged so the user's expansions survive re-renders.
  const prevDefaultRef = useRef<string[]>([]);
  useEffect(() => {
    const next = defaultExpandedIds.join('\0');
    const prev = prevDefaultRef.current.join('\0');
    if (next === prev) return;
    prevDefaultRef.current = defaultExpandedIds;
    setExpandedIds(defaultExpandedIds);
  }, [defaultExpandedIds]);

  const treeRef = useRef<ExplorerTreeHandle>(null);

  useEffect(() => {
    if (!isFiltering) return;
    treeRef.current?.setExpanded(defaultExpandedIds);
  }, [defaultExpandedIds, isFiltering]);

  const revealRequest = useGlobalStore((s) => s.status.workingSidebarRevealRequest);
  const setWorkingSidebarTab = useGlobalStore((s) => s.setWorkingSidebarTab);

  useEffect(() => {
    if (!revealRequest) return;
    const { path, nonce: _nonce } = revealRequest;

    const nodeIds = new Set(nodes.map((n) => n.id));
    if (!nodeIds.has(path)) return;

    const ancestors = getAncestorIds(path);
    const nextExpanded = Array.from(new Set([...expandedIds, ...ancestors]));
    treeRef.current?.setExpanded(nextExpanded);
    treeRef.current?.select(path);
    treeRef.current?.focus(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealRequest?.nonce, nodes]);

  const openLocalFile = useChatStore((s) => s.openLocalFile);

  const openNode = useCallback(
    (node: ExplorerTreeNode<ProjectFileIndexEntry>) => {
      if (!node.data) return;
      if (node.isFolder) {
        if (isRemote) return;

        void localFileService.openLocalFileOrFolder(node.data.path, true);
        return;
      }
      openLocalFile({ deviceId, filePath: node.data.path, workingDirectory: projectRoot });
    },
    [deviceId, isRemote, openLocalFile, projectRoot],
  );

  const handleNodeClick = useCallback(
    (node: ExplorerTreeNode<ProjectFileIndexEntry>) => {
      // Folders expand via the tree; files open in the preview panel.
      if (node.isFolder) return;
      openNode(node);
    },
    [openNode],
  );

  const getContextMenuItems = useCallback(
    (node: ExplorerTreeNode<ProjectFileIndexEntry>): MenuProps['items'] => {
      if (!node.data) return [];

      const { path, relativePath } = node.data;
      const isDirty = dirtyFilePaths.has(relativePath);

      // OS-level actions (open in app / reveal in Finder) only work on the local
      // machine — omit them for a remote device.
      const localActions: MenuProps['items'] = isRemote
        ? []
        : [
            {
              key: 'open',
              label: t('workingPanel.files.open'),
              onClick: () => openNode(node),
            },
            { key: 'divider-reveal', type: 'divider' as const },
            {
              key: 'show-in-system',
              label: t('workingPanel.files.showInSystem'),
              onClick: () => void localFileService.openFileFolder(path),
            },
          ];

      const reviewActions: MenuProps['items'] = isDirty
        ? [
            {
              key: 'show-in-review',
              label: t('workingPanel.files.showInReview'),
              onClick: () => setWorkingSidebarTab('review'),
            },
          ]
        : [];

      const before = [...localActions, ...reviewActions];

      return [
        ...before,
        ...(before.length > 0 ? [{ key: 'divider-copy', type: 'divider' as const }] : []),
        {
          key: 'copy-absolute-path',
          label: t('workingPanel.files.copyAbsolutePath'),
          onClick: async () => {
            await copyToClipboard(path);
            message.success(t('workingPanel.review.copied'));
          },
        },
        {
          key: 'copy-relative-path',
          label: t('workingPanel.files.copyRelativePath'),
          onClick: async () => {
            await copyToClipboard(relativePath);
            message.success(t('workingPanel.review.copied'));
          },
        },
      ];
    },
    [dirtyFilePaths, isRemote, openNode, setWorkingSidebarTab, t],
  );

  const isEmpty = nodes.length === 0;

  if (!data && isLoading) {
    return (
      <Center flex={1}>
        <NeuralNetworkLoading size={48} />
      </Center>
    );
  }

  return (
    <Flexbox height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
      <div className={styles.subheader}>
        <SearchBar
          allowClear
          placeholder={t('workingPanel.files.searchPlaceholder')}
          size={'small'}
          style={{ width: '100%' }}
          styles={{ input: { width: '100%' } }}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={stopPropagation}
        />
      </div>
      {isEmpty && isFiltering && isSearching ? (
        <Center flex={1}>
          <NeuralNetworkLoading size={32} />
        </Center>
      ) : isEmpty ? (
        <Center flex={1} gap={8} paddingBlock={24}>
          <Empty
            icon={FileIcon}
            description={t(
              isFiltering && debouncedQuery === searchQuery
                ? 'workingPanel.files.noSearchResults'
                : 'workingPanel.files.empty',
            )}
          />
        </Center>
      ) : (
        <div className={styles.tree} style={treeStyleVars}>
          <ExplorerTree<ProjectFileIndexEntry>
            iconsColored
            defaultExpandedIds={defaultExpandedIds}
            getContextMenuItems={getContextMenuItems}
            gitStatus={gitStatus}
            iconSet="complete"
            nodes={nodes}
            ref={treeRef}
            style={{ height: '100%' }}
            unsafeCSS={FILE_TREE_UNSAFE_CSS}
            onExpandedChange={setExpandedIds}
            onNodeClick={handleNodeClick}
          />
        </div>
      )}
    </Flexbox>
  );
});

Files.displayName = 'AgentWorkingSidebarFiles';

export default Files;

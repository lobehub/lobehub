'use client';

import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { Center, Empty, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { ActionIcon, Button, DropdownMenu, Input, Spin } from '@lobehub/ui/base-ui';
import type { GitStatusEntry } from '@pierre/trees';
import { createStaticStyles } from 'antd-style';
import {
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  FileIcon,
  FilePlusIcon,
  FileWarningIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  FoldVerticalIcon,
  GitCompareArrowsIcon,
  RotateCwIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExplorerTreeNode } from '@/features/ExplorerTree';
import { ExplorerTree, getExplorerTreeStyleVars } from '@/features/ExplorerTree';
import type { ExplorerTreeHandle } from '@/features/ExplorerTree/types';
import { useClientDataSWR } from '@/libs/swr';
import { projectFileService } from '@/services/projectFile';
import { useGlobalStore } from '@/store/global';

import { filterProjectFileEntries, mergeMissingDeletedEntries } from './fileFilter';
import { FILE_TREE_UNSAFE_CSS } from './fileTreeStyle';
import { isExcludedProjectFileEntry } from './fileVisibility';
import { getAncestorIds, getParentRelativePath, PROJECT_ROOT_NODE_ID } from './treePaths';
import { useCollapsedDirectoryChildren } from './useCollapsedDirectoryChildren';
import { useFileTreeActions } from './useFileTreeActions';
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
  /**
   * Serves the tree from a sandbox INSTANCE, with no conversation involved —
   * the environment panel browsing an instance nobody is talking to.
   */
  sandboxInstanceId?: string;
  /**
   * Serves the tree from the cloud sandbox's workspace instead of a machine.
   * The topic names the warm session the read goes through; it is not a scope.
   */
  sandboxTopicId?: string;
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
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

    padding-block: 6px 8px;
    padding-inline: 12px;
  `,
  search: css`
    flex: 1;
    min-width: 0;
  `,
  truncated: css`
    flex-shrink: 0;

    padding-block: 4px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const FILE_SEARCH_DEBOUNCE_MS = 180;
const PROJECT_FILE_TREE_SEARCH_LIMIT = 200;

type FileViewMode = 'project' | 'changes';

const getProjectRootName = (root: string) => {
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  return normalizedRoot.split(/[\\/]/).pop() || root;
};

const buildTreeNodes = (
  entries: ProjectFileIndexEntry[],
  rootName: string,
): ExplorerTreeNode<ProjectFileIndexEntry>[] => {
  // The index gives every file plus the chain of containing directories, each
  // with a unique relativePath (directories end with "/"). Use that string as
  // the stable node id and derive parentId from the path itself.
  const ids = new Set(entries.map((entry) => entry.relativePath));
  return [
    {
      id: PROJECT_ROOT_NODE_ID,
      isFolder: true,
      name: rootName,
      parentId: null,
    },
    ...entries.map((entry) => {
      const parentRel = getParentRelativePath(entry.relativePath);
      const parentId = parentRel && ids.has(parentRel) ? parentRel : PROJECT_ROOT_NODE_ID;
      return {
        data: entry,
        id: entry.relativePath,
        isFolder: entry.isDirectory,
        name: entry.name,
        parentId,
      };
    }),
  ];
};

const buildIgnoredGitStatusEntries = (entries: ProjectFileIndexEntry[]): GitStatusEntry[] =>
  entries
    .filter((entry) => entry.gitIgnored)
    .map((entry) => ({ path: entry.relativePath, status: 'ignored' }));

const prefixGitStatusPaths = (entries: GitStatusEntry[], rootName: string): GitStatusEntry[] =>
  entries.map((entry) => ({ ...entry, path: `${rootName}/${entry.path}` }));

interface FilesSearchBarProps {
  onClose: () => void;
  onDebouncedChange: (query: string) => void;
}

// Keystrokes stay local to this component: only the debounced query reaches
// the tree host, so typing never re-renders the ExplorerTree subtree.
const FilesSearchBar = memo<FilesSearchBarProps>(({ onClose, onDebouncedChange }) => {
  const { t } = useTranslation('chat');
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => onDebouncedChange(searchQuery), FILE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [onDebouncedChange, searchQuery]);

  return (
    <Input
      placeholder={t('workingPanel.files.searchPlaceholder')}
      prefix={<Icon icon={SearchIcon} size={13} />}
      ref={inputRef}
      size={'small'}
      style={{ width: '100%' }}
      value={searchQuery}
      suffix={
        <ActionIcon
          icon={XIcon}
          size={12}
          onClick={() => {
            if (searchQuery) setSearchQuery('');
            else onClose();
          }}
        />
      }
      onChange={(e) => setSearchQuery(e.target.value)}
      onKeyDown={(event) => {
        stopPropagation(event);
        if (event.key !== 'Escape') return;
        setSearchQuery('');
        onDebouncedChange('');
        onClose();
      }}
    />
  );
});

FilesSearchBar.displayName = 'FilesSearchBar';

const Files = memo<FilesProps>(
  ({ deviceId, sandboxInstanceId, sandboxTopicId, workingDirectory }) => {
    const { t } = useTranslation('chat');
    // Nothing here runs on this machine's filesystem: a remote device and the
    // sandbox both answer over the network, and neither can be handed to Electron
    // to reveal in a file manager.
    const isSandbox = !!sandboxTopicId || !!sandboxInstanceId;
    const { data, error, isLoading } = useProjectFiles(deviceId, workingDirectory, {
      instanceId: sandboxInstanceId,
      topicId: sandboxTopicId,
    });
    const { data: gitFiles } = useGitWorkingTreeFiles(
      deviceId,
      workingDirectory,
      data?.source === 'git',
    );
    const projectSource = data?.source;
    const projectRoot = data?.root ?? workingDirectory;

    const entries = useMemo(() => data?.entries ?? [], [data]);
    const [viewMode, setViewMode] = useState<FileViewMode>('project');
    const [hideIgnored, setHideIgnored] = useState(false);
    const [searchExpanded, setSearchExpanded] = useState(false);
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    const projectRootName = getProjectRootName(projectRoot);
    const normalizedDebouncedQuery = debouncedQuery.trim();
    const isFiltering = normalizedDebouncedQuery.length > 0;
    const changedOnly = viewMode === 'changes';
    const hasDisplayFilter = isFiltering || changedOnly || hideIgnored;
    const workingTreeGitStatus = useMemo(() => buildGitStatusEntries(gitFiles), [gitFiles]);
    const dirtyFilePaths = useMemo(
      () => new Set(workingTreeGitStatus.map((entry) => entry.path)),
      [workingTreeGitStatus],
    );
    // The index delivers fully git-ignored folders as childless collapsed rows;
    // their children stream in here as the user expands them.
    const {
      children: collapsedChildren,
      invalidate: invalidateCollapsedChildren,
      truncatedCount,
    } = useCollapsedDirectoryChildren({
      deviceId,
      entries,
      expandedIds,
      projectRoot,
    });
    // The sandbox index arrives whole, so matching it here costs one pass and
    // needs no third search transport. Matching on the path, not the name,
    // keeps `reports/q3` finding the file inside `reports`.
    const sandboxMatches = useMemo(() => {
      if (!isSandbox || !normalizedDebouncedQuery) return undefined;
      const needle = normalizedDebouncedQuery.toLowerCase();

      return entries
        .filter((entry) => !entry.isDirectory && entry.relativePath.toLowerCase().includes(needle))
        .slice(0, PROJECT_FILE_TREE_SEARCH_LIMIT);
    }, [entries, isSandbox, normalizedDebouncedQuery]);

    // Everything else searches over the wire. Through SWR rather than an
    // effect, so the query is deduped and cached — and, more to the point, so
    // it stops re-firing every time the file index refreshes, which an effect
    // reading `entries` did on each poll.
    const { data: remoteMatches, isLoading: isSearchingRemote } = useClientDataSWR(
      isSandbox || !normalizedDebouncedQuery
        ? null
        : [
            'project-file-search',
            deviceId,
            workingDirectory,
            normalizedDebouncedQuery,
            changedOnly,
            hideIgnored,
          ],
      () =>
        projectFileService
          .searchProjectFiles({
            changedOnly,
            deviceId,
            excludeIgnored: hideIgnored,
            limit: PROJECT_FILE_TREE_SEARCH_LIMIT,
            query: normalizedDebouncedQuery,
            scope: workingDirectory,
          })
          .then((result) => result?.entries ?? [])
          .catch((error) => {
            console.error('[Files] Failed to search project files:', error);
            return [] as ProjectFileIndexEntry[];
          }),
    );

    const searchEntries = isSandbox ? sandboxMatches : remoteMatches;
    const isSearching = !isSandbox && !!normalizedDebouncedQuery && isSearchingRemote;

    const displayEntries = useMemo(() => {
      const indexedEntries = isFiltering
        ? (searchEntries ?? [])
        : [...entries, ...collapsedChildren];
      const entriesWithDeleted = mergeMissingDeletedEntries(
        indexedEntries,
        isFiltering ? [] : (gitFiles?.deleted ?? []),
        projectRoot,
      );
      const visibleEntries = entriesWithDeleted.filter(
        (entry) => !isExcludedProjectFileEntry(entry),
      );

      return filterProjectFileEntries(visibleEntries, dirtyFilePaths, {
        changedOnly,
        hideIgnored,
      });
    }, [
      changedOnly,
      collapsedChildren,
      dirtyFilePaths,
      entries,
      gitFiles?.deleted,
      hideIgnored,
      isFiltering,
      projectRoot,
      searchEntries,
    ]);
    const nodes = useMemo(
      () => buildTreeNodes(displayEntries, projectRootName),
      [displayEntries, projectRootName],
    );
    const gitStatus = useMemo(
      () =>
        prefixGitStatusPaths(
          [...buildIgnoredGitStatusEntries(displayEntries), ...workingTreeGitStatus],
          projectRootName,
        ),
      [displayEntries, projectRootName, workingTreeGitStatus],
    );
    // Pre-expand top-level directories so the user sees something useful on first
    // paint without having to click through every folder.
    const defaultExpandedIds = useMemo(
      () =>
        nodes
          .filter(
            (node) =>
              node.id === PROJECT_ROOT_NODE_ID || (node.isFolder && (isFiltering || changedOnly)),
          )
          .map((node) => node.id),
      [changedOnly, isFiltering, nodes],
    );
    const treeStyleVars = useMemo(
      () => getExplorerTreeStyleVars({ reserveChevronSlot: nodes.some((node) => node.isFolder) }),
      [nodes],
    );

    useEffect(() => {
      setViewMode('project');
    }, [deviceId, workingDirectory]);

    useEffect(() => {
      if (projectSource && projectSource !== 'git') setViewMode('project');
    }, [projectSource]);

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

    const handleCollapseAll = useCallback(() => {
      treeRef.current?.setExpanded([]);
      setExpandedIds([]);
    }, []);

    const viewItems = useMemo(
      () => [
        {
          extra: viewMode === 'project' ? <CheckIcon size={14} /> : undefined,
          icon: <FolderTreeIcon size={14} />,
          key: 'project',
          label: t('workingPanel.files.views.project'),
          onClick: () => setViewMode('project'),
        },
        {
          disabled: data?.source !== 'git',
          extra: viewMode === 'changes' ? <CheckIcon size={14} /> : undefined,
          icon: <GitCompareArrowsIcon size={14} />,
          key: 'changes',
          label: t('workingPanel.files.views.changes'),
          onClick: () => setViewMode('changes'),
        },
      ],
      [data?.source, t, viewMode],
    );

    useEffect(() => {
      if (!isFiltering) return;
      treeRef.current?.setExpanded(defaultExpandedIds);
    }, [defaultExpandedIds, isFiltering]);

    const revealRequest = useGlobalStore((s) => s.status.workingSidebarRevealRequest);

    useEffect(() => {
      if (!revealRequest) return;
      const { path, nonce: _nonce } = revealRequest;

      const nodeIds = new Set(nodes.map((n) => n.id));
      if (!nodeIds.has(path)) return;

      const ancestors = [PROJECT_ROOT_NODE_ID, ...getAncestorIds(path)];
      const nextExpanded = Array.from(new Set([...expandedIds, ...ancestors]));
      treeRef.current?.setExpanded(nextExpanded);
      treeRef.current?.select(path);
      treeRef.current?.focus(path);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revealRequest?.nonce, nodes]);

    const clearDisplayFilter = useCallback(() => {
      setSearchExpanded(false);
      setDebouncedQuery('');
      setViewMode('project');
      setHideIgnored(false);
    }, []);
    const knownEntries = useMemo(
      () => [...entries, ...collapsedChildren],
      [collapsedChildren, entries],
    );
    const deletedPaths = useMemo(() => new Set(gitFiles?.deleted ?? []), [gitFiles?.deleted]);
    const actions = useFileTreeActions({
      deletedPaths,
      deviceId,
      dirtyFilePaths,
      expandedIds,
      hasDisplayFilter,
      invalidateCollapsedChildren,
      knownEntries,
      nodes,
      onClearDisplayFilter: clearDisplayFilter,
      onCollapseAll: handleCollapseAll,
      projectRoot,
      sandboxInstanceId,
      sandboxTopicId,
      treeRef,
      workingDirectory,
    });

    // Tree-level actions live behind "…" so the header keeps room: creating at
    // the project root, refresh, then the ignored-files filter.
    const moreItems = useMemo(
      () => [
        // Absent for a read-only tree (a persistent sandbox instance), whose
        // files the mutation helpers cannot reach.
        ...(actions.startCreateFromHeader
          ? [
              {
                icon: <FilePlusIcon size={14} />,
                key: 'new-file',
                label: t('workingPanel.files.actions.newFile'),
                onClick: () => actions.startCreateFromHeader?.('file'),
              },
              {
                icon: <FolderPlusIcon size={14} />,
                key: 'new-folder',
                label: t('workingPanel.files.actions.newFolder'),
                onClick: () => actions.startCreateFromHeader?.('folder'),
              },
              { key: 'divider-refresh', type: 'divider' as const },
            ]
          : []),
        {
          disabled: actions.refreshing,
          icon: <RotateCwIcon size={14} />,
          key: 'refresh',
          label: t('workingPanel.files.actions.refresh'),
          onClick: () => void actions.refresh(),
        },
        { key: 'divider-filters', type: 'divider' as const },
        {
          checked: hideIgnored,
          key: 'hide-ignored',
          label: t('workingPanel.files.filters.hideIgnored'),
          onCheckedChange: setHideIgnored,
          type: 'checkbox' as const,
        },
      ],
      [actions, hideIgnored, t],
    );

    const isEmpty = displayEntries.length === 0;

    if (!data && isLoading) {
      return (
        <Center flex={1}>
          <Spin size="large" />
        </Center>
      );
    }

    return (
      <Flexbox height={'100%'} style={{ overflow: 'hidden' }} width={'100%'}>
        <div className={styles.subheader}>
          {searchExpanded ? (
            <div className={styles.search}>
              <FilesSearchBar
                onClose={() => setSearchExpanded(false)}
                onDebouncedChange={setDebouncedQuery}
              />
            </div>
          ) : (
            <>
              <DropdownMenu items={viewItems} placement={'bottomLeft'}>
                <Button
                  icon={viewMode === 'project' ? FolderTreeIcon : GitCompareArrowsIcon}
                  size={'small'}
                  style={{ maxWidth: 'calc(100% - 84px)' }}
                  title={t('workingPanel.files.views.title')}
                  type={'text'}
                >
                  {t(
                    viewMode === 'project'
                      ? 'workingPanel.files.views.project'
                      : 'workingPanel.files.views.changes',
                  )}
                  <ChevronDownIcon size={12} />
                </Button>
              </DropdownMenu>
              <div style={{ flex: 1 }} />
            </>
          )}
          {!searchExpanded && (
            <ActionIcon
              icon={SearchIcon}
              size={'small'}
              title={t('workingPanel.files.search')}
              onClick={() => setSearchExpanded(true)}
            />
          )}
          <ActionIcon
            disabled={nodes.length === 0}
            icon={FoldVerticalIcon}
            size={'small'}
            title={t('workingPanel.files.collapseAll')}
            onClick={handleCollapseAll}
          />
          <DropdownMenu items={moreItems} placement={'bottomRight'}>
            <ActionIcon
              active={hideIgnored}
              icon={EllipsisIcon}
              loading={actions.refreshing}
              size={'small'}
              title={t('workingPanel.files.actions.more')}
            />
          </DropdownMenu>
        </div>
        {isEmpty && isFiltering && isSearching ? (
          <Center flex={1}>
            <Spin size="large" />
          </Center>
        ) : isEmpty && !actions.pendingCreate ? (
          <Center flex={1} gap={8} paddingBlock={24}>
            {/* A failed read and an empty directory look identical once the tree
              is empty, and they are not the same thing to act on: one is
              "nothing here yet", the other is "we could not find out". Saying
              the workspace is empty when the listing failed is the worse of the
              two lies — it invites the user to conclude their files are gone. */}
            <Empty
              icon={error ? FileWarningIcon : FileIcon}
              description={t(
                error
                  ? 'workingPanel.files.unreadable'
                  : hasDisplayFilter
                    ? 'workingPanel.files.noSearchResults'
                    : 'workingPanel.files.empty',
              )}
            />
          </Center>
        ) : (
          <div className={styles.tree} style={treeStyleVars}>
            <ExplorerTree<ProjectFileIndexEntry>
              iconsColored
              canDrag={actions.canDrag}
              canDrop={actions.canDrop}
              canRename={actions.canRename}
              defaultExpandedIds={defaultExpandedIds}
              getBlankContextMenuItems={actions.getBlankContextMenuItems}
              getContextMenuItems={actions.getContextMenuItems}
              gitStatus={gitStatus}
              iconSet="complete"
              nodes={nodes}
              ref={treeRef}
              style={{ height: '100%' }}
              unsafeCSS={FILE_TREE_UNSAFE_CSS}
              validateName={actions.validateName}
              onCommitCreate={actions.onCommitCreate}
              onCommitRename={actions.onCommitRename}
              onExpandedChange={setExpandedIds}
              onMove={actions.onMove}
              onNodeClick={actions.handleNodeClick}
              onNodeDragStart={actions.handleNodeDragStart}
              onTreeKeyDown={actions.handleTreeKeyDown}
            />
          </div>
        )}
        {truncatedCount > 0 && (
          <div className={styles.truncated}>{t('workingPanel.files.truncatedNotice')}</div>
        )}
      </Flexbox>
    );
  },
);

Files.displayName = 'AgentWorkingSidebarFiles';

export default Files;

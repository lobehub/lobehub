'use client';

import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { Center, copyToClipboard, Empty, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { ActionIcon, Button, DropdownMenu, Input, toast } from '@lobehub/ui/base-ui';
import type { GitStatusEntry } from '@pierre/trees';
import { createStaticStyles } from 'antd-style';
import {
  CheckIcon,
  ChevronDownIcon,
  FileIcon,
  FolderTreeIcon,
  FoldVerticalIcon,
  GitCompareArrowsIcon,
  ListFilterIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import type { DragEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { startWorkspaceFileDrag } from '@/features/ChatInput/InputEditor/workspaceFileDragData';
import type { ExplorerTreeNode } from '@/features/ExplorerTree';
import {
  ExplorerTree,
  FOLDER_ICON_CSS,
  getExplorerTreeStyleVars,
  HIDE_POINTER_FOCUS_RING_CSS,
} from '@/features/ExplorerTree';
import type { ExplorerTreeHandle } from '@/features/ExplorerTree/types';
import { usePublishWorkspaceHtmlFromFile } from '@/features/Portal/LocalFile/usePublishWorkspaceHtmlFromFile';
import type { NativeContextMenuItem } from '@/libs/contextMenu/types';
import { localFileService } from '@/services/electron/localFileService';
import { projectFileService } from '@/services/projectFile';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

import { filterProjectFileEntries, mergeMissingDeletedEntries } from './fileFilter';
import { isExcludedProjectFileEntry } from './fileVisibility';
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
}));

const stripTrailingSlash = (value: string) => (value.endsWith('/') ? value.slice(0, -1) : value);

const IGNORED_FILE_OPACITY_CSS = `
[data-item-git-status='ignored'] > :where(
  [data-item-section='icon'],
  [data-item-section='content'],
  [data-item-section='decoration'],
  [data-item-section='git']
) {
  opacity: 0.7;
}`;
const FILE_TREE_UNSAFE_CSS = [
  FOLDER_ICON_CSS,
  HIDE_POINTER_FOCUS_RING_CSS,
  IGNORED_FILE_OPACITY_CSS,
].join('\n');
const FILE_SEARCH_DEBOUNCE_MS = 180;
const PROJECT_FILE_TREE_SEARCH_LIMIT = 200;
// Relative file paths cannot contain NUL, so this synthetic id cannot collide with an indexed entry.
const PROJECT_ROOT_NODE_ID = '\0project-root';

type FileViewMode = 'project' | 'changes';

const getProjectRootName = (root: string) => {
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  return normalizedRoot.split(/[\\/]/).pop() || root;
};

const getParentRelativePath = (relativePath: string): string | null => {
  const cleaned = stripTrailingSlash(relativePath);
  const idx = cleaned.lastIndexOf('/');
  if (idx < 0) return null;
  return `${cleaned.slice(0, idx)}/`;
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

const getAncestorIds = (filePath: string): string[] => {
  const segments = filePath.split('/');
  const ancestors: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    ancestors.push(segments.slice(0, i).join('/') + '/');
  }
  return ancestors;
};

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

const Files = memo<FilesProps>(({ deviceId, workingDirectory }) => {
  const { t } = useTranslation('chat');
  const isRemote = !!deviceId;
  const { data, isLoading } = useProjectFiles(deviceId, workingDirectory);
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
  const [searchEntries, setSearchEntries] = useState<ProjectFileIndexEntry[] | undefined>();
  const [isSearching, setIsSearching] = useState(false);
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
  const displayEntries = useMemo(() => {
    const indexedEntries = isFiltering ? (searchEntries ?? []) : entries;
    const entriesWithDeleted = mergeMissingDeletedEntries(
      indexedEntries,
      isFiltering ? [] : (gitFiles?.deleted ?? []),
      projectRoot,
    );
    const visibleEntries = entriesWithDeleted.filter((entry) => !isExcludedProjectFileEntry(entry));

    return filterProjectFileEntries(visibleEntries, dirtyFilePaths, {
      changedOnly,
      hideIgnored,
    });
  }, [
    changedOnly,
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

  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  useEffect(() => {
    setViewMode('project');
  }, [deviceId, workingDirectory]);

  useEffect(() => {
    if (projectSource && projectSource !== 'git') setViewMode('project');
  }, [projectSource]);

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
        changedOnly,
        deviceId,
        excludeIgnored: hideIgnored,
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
  }, [changedOnly, deviceId, hideIgnored, normalizedDebouncedQuery, workingDirectory]);

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

  const filterItems = useMemo(
    () => [
      {
        checked: hideIgnored,
        key: 'hide-ignored',
        label: t('workingPanel.files.filters.hideIgnored'),
        onCheckedChange: setHideIgnored,
        type: 'checkbox' as const,
      },
    ],
    [hideIgnored, t],
  );

  useEffect(() => {
    if (!isFiltering) return;
    treeRef.current?.setExpanded(defaultExpandedIds);
  }, [defaultExpandedIds, isFiltering]);

  const revealRequest = useGlobalStore((s) => s.status.workingSidebarRevealRequest);
  const openWorkingSidebar = useGlobalStore((s) => s.openWorkingSidebar);

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

  const openLocalFile = useChatStore((s) => s.openLocalFile);
  const { canOfferFile, publishFile } = usePublishWorkspaceHtmlFromFile({
    deviceId,
    workingDirectory: projectRoot,
  });

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

  // Dragging a row into the chat input inserts a `<localFile />` mention instead
  // of uploading it. We stamp a custom MIME on dragstart; the input's
  // useWorkspaceFileDrop reads it. The panel has no onMove, so overriding the
  // drag effect here can't disturb any internal reorder behaviour.
  const handleNodeDragStart = useCallback(
    (node: ExplorerTreeNode<ProjectFileIndexEntry>, event: DragEvent<HTMLElement>) => {
      if (!node.data) return;
      startWorkspaceFileDrag(event, {
        isDirectory: !!node.isFolder,
        name: node.data.name,
        path: node.data.path,
      });
    },
    [],
  );

  const getContextMenuItems = useCallback(
    (node: ExplorerTreeNode<ProjectFileIndexEntry>): NativeContextMenuItem[] => {
      if (!node.data) return [];

      const { path, relativePath } = node.data;
      const isDirty = dirtyFilePaths.has(relativePath);
      const items: NativeContextMenuItem[] = [];

      if (!isRemote) {
        items.push({
          key: 'open',
          label: t('workingPanel.files.open'),
          onClick: () => openNode(node),
        });
      }

      if (canOfferFile(path, !!node.isFolder)) {
        items.push({
          key: 'publish',
          label: t('workingPanel.localFile.publish.action'),
          sfSymbol: 'square.and.arrow.up',
          onClick: () => {
            void publishFile(path);
          },
        });
      }

      if (!isRemote) {
        items.push(
          { key: 'divider-reveal', type: 'divider' as const },
          {
            key: 'show-in-system',
            label: t('workingPanel.files.showInSystem'),
            onClick: () => void localFileService.openFileFolder(path),
          },
        );
      }

      if (isDirty) {
        items.push({
          key: 'show-in-review',
          label: t('workingPanel.files.showInReview'),
          onClick: () => openWorkingSidebar('review'),
        });
      }

      if (items.length > 0) {
        items.push({ key: 'divider-copy', type: 'divider' as const });
      }

      items.push(
        {
          key: 'copy-absolute-path',
          label: t('workingPanel.files.copyAbsolutePath'),
          onClick: async () => {
            await copyToClipboard(path);
            toast.success(t('workingPanel.review.copied'));
          },
          sfSymbol: 'doc.on.doc',
        },
        {
          key: 'copy-relative-path',
          label: t('workingPanel.files.copyRelativePath'),
          onClick: async () => {
            await copyToClipboard(relativePath);
            toast.success(t('workingPanel.review.copied'));
          },
          sfSymbol: 'doc.on.doc',
        },
      );

      return items;
    },
    [canOfferFile, dirtyFilePaths, isRemote, openNode, openWorkingSidebar, publishFile, t],
  );

  const isEmpty = displayEntries.length === 0;

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
        <DropdownMenu items={filterItems} placement={'bottomRight'}>
          <ActionIcon
            active={hideIgnored}
            icon={ListFilterIcon}
            size={'small'}
            title={t('workingPanel.files.filters.title')}
          />
        </DropdownMenu>
        <ActionIcon
          disabled={nodes.length === 0}
          icon={FoldVerticalIcon}
          size={'small'}
          title={t('workingPanel.files.collapseAll')}
          onClick={handleCollapseAll}
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
              hasDisplayFilter ? 'workingPanel.files.noSearchResults' : 'workingPanel.files.empty',
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
            onNodeDragStart={handleNodeDragStart}
          />
        </div>
      )}
    </Flexbox>
  );
});

Files.displayName = 'AgentWorkingSidebarFiles';

export default Files;

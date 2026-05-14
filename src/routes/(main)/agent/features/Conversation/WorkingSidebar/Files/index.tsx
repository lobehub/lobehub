'use client';

import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';
import { ActionIcon, Center, copyToClipboard, Empty, Flexbox } from '@lobehub/ui';
import type { MenuProps } from 'antd';
import { message } from 'antd';
import { createStaticStyles } from 'antd-style';
import { FileIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import type { ExplorerTreeNode } from '@/features/ExplorerTree';
import { ExplorerTree, FOLDER_ICON_CSS } from '@/features/ExplorerTree';
import type { ExplorerTreeHandle } from '@/features/ExplorerTree/types';
import { localFileService } from '@/services/electron/localFileService';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

import { buildGitStatusEntries, useGitWorkingTreeFiles } from './useGitWorkingTreeFiles';
import { useProjectFiles } from './useProjectFiles';

interface FilesProps {
  workingDirectory: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  tree: css`
    --trees-bg-override: transparent;
    --trees-border-color-override: transparent;
    --trees-selected-bg-override: ${cssVar.colorFillSecondary};
    --trees-bg-muted-override: ${cssVar.colorFillTertiary};
    --trees-fg-override: ${cssVar.colorText};
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
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 4px 8px;
    padding-inline: 14px 6px;
  `,
  count: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
}));

const stripTrailingSlash = (value: string) => (value.endsWith('/') ? value.slice(0, -1) : value);

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

const Files = memo<FilesProps>(({ workingDirectory }) => {
  const { t } = useTranslation('chat');
  const { data, isLoading, isValidating, mutate } = useProjectFiles(workingDirectory);
  const { data: gitFiles } = useGitWorkingTreeFiles(workingDirectory, data?.source === 'git');

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const nodes = useMemo(() => buildTreeNodes(entries), [entries]);
  const gitStatus = useMemo(() => buildGitStatusEntries(gitFiles), [gitFiles]);
  const dirtyFilePaths = useMemo(() => new Set(gitStatus.map((entry) => entry.path)), [gitStatus]);
  // Pre-expand top-level directories so the user sees something useful on first
  // paint without having to click through every folder.
  const defaultExpandedIds = useMemo(
    () => nodes.filter((node) => node.isFolder && node.parentId == null).map((node) => node.id),
    [nodes],
  );

  const [expandedIds, setExpandedIds] = useState<string[]>([]);

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

  const revealRequest = useGlobalStore((s) => s.status.workingSidebarRevealRequest);
  const setWorkingSidebarTab = useGlobalStore((s) => s.setWorkingSidebarTab);

  useEffect(() => {
    if (!revealRequest) return;
    const { path, nonce: _nonce } = revealRequest;

    const nodeIds = new Set(nodes.map((n) => n.id));
    if (!nodeIds.has(path)) {
      // Data may still be loading — retry silently instead of showing a warning.
      if (!isLoading) {
        void message.warning(t('workingPanel.review.revealNotFound'));
      }
      return;
    }

    const ancestors = getAncestorIds(path);
    const nextExpanded = Array.from(new Set([...expandedIds, ...ancestors]));
    treeRef.current?.setExpanded(nextExpanded);
    treeRef.current?.select(path);
    treeRef.current?.focus(path);
    // Re-run when nonce changes (user re-triggers) or when nodes/isLoading
    // update (data arrives after initial reveal attempt).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealRequest?.nonce, nodes, isLoading]);

  const openLocalFile = useChatStore((s) => s.openLocalFile);

  const openNode = useCallback(
    (node: ExplorerTreeNode<ProjectFileIndexEntry>) => {
      if (!node.data) return;
      if (node.isFolder) {
        void localFileService.openLocalFileOrFolder(node.data.path, true);
        return;
      }
      openLocalFile({ filePath: node.data.path, workingDirectory });
    },
    [openLocalFile, workingDirectory],
  );

  const handleNodeClick = useCallback(
    (node: ExplorerTreeNode<ProjectFileIndexEntry>) => {
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

      return [
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
        ...(isDirty
          ? [
              {
                key: 'show-in-review',
                label: t('workingPanel.files.showInReview'),
                onClick: () => setWorkingSidebarTab('review'),
              },
            ]
          : []),
        { key: 'divider-copy', type: 'divider' as const },
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
    [dirtyFilePaths, openNode, setWorkingSidebarTab, t],
  );

  const fileCount = data?.totalCount ?? entries.filter((e) => !e.isDirectory).length;
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
        <span className={styles.count}>{t('workingPanel.files.count', { count: fileCount })}</span>
        <ActionIcon
          icon={RefreshCwIcon}
          loading={isValidating}
          size={'small'}
          title={t('workingPanel.files.refresh')}
          onClick={() => void mutate()}
        />
      </div>
      {isEmpty ? (
        <Center flex={1} gap={8} paddingBlock={24}>
          <Empty description={t('workingPanel.files.empty')} icon={FileIcon} />
        </Center>
      ) : (
        <div className={styles.tree}>
          <ExplorerTree<ProjectFileIndexEntry>
            iconsColored
            defaultExpandedIds={defaultExpandedIds}
            density="compact"
            getContextMenuItems={getContextMenuItems}
            gitStatus={gitStatus}
            iconSet="complete"
            nodes={nodes}
            ref={treeRef}
            style={{ height: '100%' }}
            unsafeCSS={FOLDER_ICON_CSS}
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

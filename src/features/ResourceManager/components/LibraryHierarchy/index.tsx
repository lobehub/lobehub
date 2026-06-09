'use client';

import { Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FolderPlusIcon } from 'lucide-react';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { VList } from 'virtua';

import { useFolderPath } from '@/routes/(main)/resource/features/hooks/useFolderPath';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { useFileStore } from '@/store/file';
import type { TreeItem } from '@/store/tree';
import { useTreeStore } from '@/store/tree';

import AddButton from '../Header/AddButton';
import { KnowledgeBaseListProvider } from '../KnowledgeBaseListProvider';
import { HierarchyNode } from './HierarchyNode';
import TreeSkeleton from './TreeSkeleton';

interface VisibleNode {
  item: TreeItem;
  key: string;
  level: number;
  parentKey: string;
}

const LibraryHierarchy = memo(() => {
  const { t } = useTranslation('file');
  const { currentFolderSlug } = useFolderPath();
  const [libraryId, currentViewItemId] = useResourceManagerStore((s) => [
    s.libraryId,
    s.currentViewItemId,
  ]);

  const children = useTreeStore((s) => s.children);
  const expanded = useTreeStore((s) => s.expanded);
  const status = useTreeStore((s) => s.status);
  const init = useTreeStore((s) => s.init);
  const expandAncestors = useTreeStore((s) => s.expandAncestors);
  const toggle = useTreeStore((s) => s.toggle);

  // Reuse Explorer Breadcrumb's SWR cache so the sidebar doesn't double-fetch
  // document.getFolderBreadcrumb when navigating into a folder.
  const useFetchFolderBreadcrumb = useFileStore((s) => s.useFetchFolderBreadcrumb);
  const { data: folderChain } = useFetchFolderBreadcrumb(currentFolderSlug);

  // Effect 1: Library switch → reset + load root
  useEffect(() => {
    if (!libraryId) return;
    init(libraryId);
  }, [libraryId, init]);

  // Effect 2: Folder navigation → expand ancestors once breadcrumb resolves
  useEffect(() => {
    if (!folderChain?.length) return;
    void expandAncestors(folderChain.map((c) => c.id));
  }, [folderChain, expandAncestors]);

  const isLoading = status[''] === 'loading';

  const visibleNodes = useMemo(() => {
    const result: VisibleNode[] = [];

    const walk = (parentKey: string, level: number) => {
      for (const node of children[parentKey] ?? []) {
        result.push({ item: node, key: node.id, level, parentKey });
        if (node.isFolder && expanded[node.id]) {
          walk(node.id, level + 1);
        }
      }
    };

    walk('', 0);
    return result;
  }, [children, expanded]);

  if (isLoading && !children['']) {
    return <TreeSkeleton />;
  }

  const selectedKey = currentFolderSlug ?? null;
  const isRootEmpty = !isLoading && libraryId && visibleNodes.length === 0;

  if (isRootEmpty) {
    return (
      <KnowledgeBaseListProvider>
        <Center gap={16} padding={24} style={{ height: '100%', textAlign: 'center' }}>
          <Icon color={cssVar.colorTextQuaternary} icon={FolderPlusIcon} size={36} />
          <Flexbox align={'center'} gap={4}>
            <Text strong>{t('library.hierarchy.empty.title')}</Text>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('library.hierarchy.empty.desc')}
            </Text>
          </Flexbox>
          <AddButton />
        </Center>
      </KnowledgeBaseListProvider>
    );
  }

  return (
    <KnowledgeBaseListProvider>
      <Flexbox paddingInline={4} style={{ height: '100%' }}>
        <VList
          bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
          style={{ height: '100%' }}
        >
          {visibleNodes.map(({ item, key, level, parentKey }) => (
            <div key={key} style={{ paddingBottom: 2 }}>
              <HierarchyNode
                isExpanded={!!expanded[item.id]}
                isLoading={status[item.id] === 'loading'}
                item={item}
                level={level}
                parentKey={parentKey}
                selectedKey={selectedKey}
                onToggle={toggle}
              />
            </div>
          ))}
        </VList>
      </Flexbox>
    </KnowledgeBaseListProvider>
  );
});

LibraryHierarchy.displayName = 'FileTree';

export default LibraryHierarchy;

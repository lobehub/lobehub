'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useEffect, useMemo } from 'react';
import { VList } from 'virtua';

import { useFolderPath } from '@/routes/(main)/resource/features/hooks/useFolderPath';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import type { TreeItem } from '@/store/tree';
import { useTreeStore } from '@/store/tree';

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
  const { currentFolderSlug } = useFolderPath();
  const [libraryId, currentViewItemId] = useResourceManagerStore((s) => [
    s.libraryId,
    s.currentViewItemId,
  ]);

  const children = useTreeStore((s) => s.children);
  const expanded = useTreeStore((s) => s.expanded);
  const status = useTreeStore((s) => s.status);
  const init = useTreeStore((s) => s.init);
  const navigateTo = useTreeStore((s) => s.navigateTo);
  const toggle = useTreeStore((s) => s.toggle);

  // Effect 1: Library switch → reset + load root
  useEffect(() => {
    if (!libraryId) return;
    init(libraryId);
  }, [libraryId, init]);

  // Effect 2: Folder navigation → expand ancestors
  useEffect(() => {
    if (!currentFolderSlug) return;
    void navigateTo(currentFolderSlug);
  }, [currentFolderSlug, navigateTo]);

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

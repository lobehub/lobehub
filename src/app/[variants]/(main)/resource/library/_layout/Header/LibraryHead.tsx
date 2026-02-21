'use client';

import { type DropdownItem } from '@lobehub/ui';
import {
  ActionIcon,
  Block,
  Center,
  DropdownMenu,
  Skeleton,
  Text,
  stopPropagation,
} from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronsUpDownIcon } from 'lucide-react';
import { type DragEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useDragActive } from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import RepoIcon from '@/components/LibIcon';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';

const styles = createStaticStyles(({ css, cssVar }) => ({
  dropZoneActive: css`
    color: ${cssVar.colorBgElevated} !important;
    background-color: ${cssVar.colorText} !important;

    * {
      color: ${cssVar.colorBgElevated} !important;
    }
  `,
  menuIcon: css`
    color: ${cssVar.colorTextTertiary};
  `,
}));

/**
 * Quickly switch between libraries
 */
const Head = memo<{ id: string }>(({ id }) => {
  const navigate = useNavigate();
  const name = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseNameById(id));
  const [setMode, setLibraryId] = useResourceManagerStore((s) => [s.setMode, s.setLibraryId]);
  const isDragActive = useDragActive();
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);

  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { data: libraries } = useFetchKnowledgeBaseList();

  const handleClick = useCallback(() => {
    navigate(`/resource/library/${id}`);
    setMode('explorer');
  }, [id, navigate, setMode]);

  const handleLibrarySwitch = useCallback(
    (libraryId: string) => {
      setLibraryId(libraryId);
      setMode('explorer');
      // 使用 setTimeout 确保在下一个事件循环中执行 navigate
      setTimeout(() => {
        navigate(`/resource/library/${libraryId}`);
      }, 0);
    },
    [navigate, setLibraryId, setMode],
  );

  // Native HTML5 drag-and-drop handlers for root directory drop
  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!isDragActive) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDropZoneActive(true);
    },
    [isDragActive],
  );

  const handleDragLeave = useCallback(() => {
    setIsDropZoneActive(false);
  }, []);

  const handleDrop = useCallback(() => {
    setIsDropZoneActive(false);
  }, []);

  const menuItems = useMemo<DropdownItem[]>(() => {
    if (!libraries) return [];

    return libraries.map((library) => ({
      icon: (
        <Center className={styles.menuIcon} style={{ minWidth: 16 }} width={16}>
          <RepoIcon size={14} />
        </Center>
      ),
      key: library.id,
      label: library.name,
      onClick: () => handleLibrarySwitch(library.id),
      style: library.id === id ? { backgroundColor: 'var(--ant-control-item-bg-active)' } : {},
    }));
  }, [libraries, handleLibrarySwitch, id, styles.menuIcon]);

  return (
    <Block
      clickable
      horizontal
      align={'center'}
      className={cx(isDropZoneActive && styles.dropZoneActive)}
      data-drop-target-id="root"
      data-is-folder="true"
      data-root-drop="true"
      gap={8}
      padding={2}
      style={{ minWidth: 32, overflow: 'hidden' }}
      variant={'borderless'}
      onClick={handleClick}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Center style={{ minWidth: 32 }} width={32}>
        <RepoIcon size={18} />
      </Center>
      {!name ? (
        <Skeleton active paragraph={false} title={{ style: { marginBottom: 0 }, width: 80 }} />
      ) : (
        <DropdownMenu items={menuItems} placement="bottomRight">
          <Center
            horizontal
            gap={4}
            style={{ cursor: 'pointer', flex: 1, overflow: 'hidden' }}
            onClick={stopPropagation}
          >
            <Text ellipsis style={{ flex: 1 }} weight={500}>
              {name}
            </Text>
            <ActionIcon
              icon={ChevronsUpDownIcon}
              style={{ width: 24 }}
              size={{
                blockSize: 28,
                size: 16,
              }}
            />
          </Center>
        </DropdownMenu>
      )}
    </Block>
  );
});

Head.displayName = 'Head';

export default Head;

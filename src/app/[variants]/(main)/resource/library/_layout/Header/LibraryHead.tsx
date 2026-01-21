'use client';

import {
  ActionIcon,
  Block,
  Center,
  type DropdownItem,
  DropdownMenu,
  Skeleton,
  Text,
} from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronsUpDownIcon } from 'lucide-react';
import { type DragEvent, memo, useCallback, useMemo, useState } from 'react';
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

const Head = memo<{ id: string }>(({ id }) => {
  const navigate = useNavigate();
  const name = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseNameById(id));
  const setMode = useResourceManagerStore((s) => s.setMode);
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
      navigate(`/resource/library/${libraryId}`);
      setMode('explorer');
    },
    [navigate, setMode],
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
      align={'center'}
      className={cx(isDropZoneActive && styles.dropZoneActive)}
      clickable
      data-drop-target-id="root"
      data-is-folder="true"
      data-root-drop="true"
      gap={8}
      horizontal
      onClick={handleClick}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      padding={2}
      style={{ minWidth: 32, overflow: 'hidden' }}
      variant={'borderless'}
    >
      <Center style={{ minWidth: 32 }} width={32}>
        <RepoIcon size={18} />
      </Center>
      {!name ? (
        <Skeleton active paragraph={false} title={{ style: { marginBottom: 0 }, width: 80 }} />
      ) : (
        <Text ellipsis style={{ flex: 1 }} weight={500}>
          {name}
        </Text>
      )}
      {name && (
        <DropdownMenu items={menuItems} placement="bottomRight">
          <ActionIcon
            icon={ChevronsUpDownIcon}
            onClick={(e) => e.stopPropagation()}
            size={{
              blockSize: 28,
              size: 16,
            }}
            style={{ width: 24 }}
          />
        </DropdownMenu>
      )}
    </Block>
  );
});

Head.displayName = 'Head';

export default Head;

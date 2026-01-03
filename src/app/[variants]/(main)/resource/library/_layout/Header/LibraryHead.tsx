'use client';

import { useDroppable } from '@dnd-kit/core';
import { Center, type DropdownItem, DropdownMenu, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronsUpDown } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useDragActive } from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import RepoIcon from '@/components/LibIcon';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/knowledgeBase';

const styles = createStaticStyles(({ css, cssVar }) => ({
  clickableHeader: css`
    cursor: pointer;
    border-radius: ${cssVar.borderRadius}px;
    transition: all 0.2s;

    &:hover {
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
  dropZoneActive: css`
    color: ${cssVar.colorBgElevated} !important;
    background-color: ${cssVar.colorText} !important;

    * {
      color: ${cssVar.colorBgElevated} !important;
    }
  `,
  icon: css`
    color: ${cssVar.colorTextSecondary};
    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
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

  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { data: libraries } = useFetchKnowledgeBaseList();

  // Special droppable ID for root folder - matches the pattern expected by DndContextWrapper
  const ROOT_DROP_ID = `__root__:${id}`;

  const { setNodeRef, isOver } = useDroppable({
    data: {
      fileType: 'custom/folder',
      isFolder: true,
      name: 'Root',
      targetId: null,
    },
    disabled: !isDragActive,
    id: ROOT_DROP_ID,
  });

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
    <Flexbox
      align={'center'}
      className={cx(styles.clickableHeader, isOver && styles.dropZoneActive)}
      gap={8}
      horizontal
      paddingBlock={6}
      paddingInline={'12px 14px'}
      ref={setNodeRef}
    >
      <Center style={{ minWidth: 24 }} width={24}>
        <RepoIcon />
      </Center>
      {!name ? (
        <Skeleton active paragraph={false} title={{ style: { marginBottom: 0 }, width: 80 }} />
      ) : (
        <Flexbox align={'center'} flex={1} gap={4} horizontal onClick={handleClick}>
          <Text ellipsis strong style={{ flex: 1, fontSize: 16 }}>
            {name}
          </Text>
        </Flexbox>
      )}
      {name && (
        <DropdownMenu items={menuItems} placement="bottomRight">
          <ChevronsUpDown
            className={styles.icon}
            onClick={(e) => e.stopPropagation()}
            size={16}
            style={{ cursor: 'pointer', flex: 'none' }}
          />
        </DropdownMenu>
      )}
    </Flexbox>
  );
});

Head.displayName = 'Head';

export default Head;

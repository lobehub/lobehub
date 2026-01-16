'use client';

import { Center, type DropdownItem, DropdownMenu, Flexbox, Skeleton, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronsUpDown } from 'lucide-react';
import { type DragEvent, memo, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useDragActive } from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import RepoIcon from '@/components/LibIcon';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';

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
    <Flexbox
      align={'center'}
      className={cx(styles.clickableHeader, isDropZoneActive && styles.dropZoneActive)}
      data-drop-target-id="root"
      data-is-folder="true"
      data-root-drop="true"
      gap={8}
      horizontal
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      paddingBlock={6}
      paddingInline={'12px 14px'}
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

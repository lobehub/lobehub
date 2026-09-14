'use client';

import { Block, Center, stopPropagation } from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { ActionIcon, DropdownMenu, Skeleton, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronsUpDownIcon } from 'lucide-react';
import type { DragEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import BusinessKnowledgeBaseImportAction from '@/business/client/BusinessKnowledgeBaseImportAction';
import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import LibraryStatusIcon from '@/components/LibIcon/StatusIcon';
import { useDragActive } from '@/features/ResourceManager/DndContextWrapper';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';

import type { LibraryMenuEntry } from './libraryMenuItems';
import { buildLibraryMenuItems } from './libraryMenuItems';

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
  const { t } = useTranslation('common');
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceId = useActiveWorkspaceId();
  const name = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseNameById(id));
  const [setMode, setLibraryId] = useResourceManagerStore((s) => [s.setMode, s.setLibraryId]);
  const isDragActive = useDragActive();
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);

  const useFetchKnowledgeBaseList = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseList);
  const { data: libraries } = useFetchKnowledgeBaseList();
  const activeLibrary = libraries?.find((library) => library.id === id) as
    (NonNullable<typeof libraries>[number] & { memberRestricted?: boolean }) | undefined;

  const handleClick = useCallback(() => {
    navigate(`/resource/library/${id}`);
    setMode('explorer');
  }, [id, navigate, setMode]);

  const handleLibrarySwitch = useCallback(
    (libraryId: string) => {
      setLibraryId(libraryId);
      setMode('explorer');
      // Use setTimeout to ensure navigate is called in the next event loop
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

    const entries = libraries.map((library): LibraryMenuEntry => ({
      item: {
        icon: (
          <Center className={styles.menuIcon} style={{ minWidth: 16 }} width={16}>
            <LibraryStatusIcon
              size={14}
              visibility={library.visibility}
              memberRestricted={
                (library as typeof library & { memberRestricted?: boolean }).memberRestricted
              }
            />
          </Center>
        ),
        key: library.id,
        label: library.name,
        onClick: () => handleLibrarySwitch(library.id),
        style: library.id === id ? { backgroundColor: 'var(--ant-control-item-bg-active)' } : {},
      },
      visibility: library.visibility,
    }));

    return buildLibraryMenuItems(entries, Boolean(activeWorkspaceId), {
      private: t('navPanel.privateAgents'),
      workspace: t('navPanel.publicAgents'),
    });
  }, [activeWorkspaceId, libraries, handleLibrarySwitch, id, t]);

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
        <LibraryStatusIcon
          memberRestricted={activeLibrary?.memberRestricted}
          size={18}
          visibility={activeLibrary?.visibility}
        />
      </Center>
      {!name ? (
        <Skeleton.Text width={80} />
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
      <BusinessKnowledgeBaseImportAction knowledgeBaseId={id} />
    </Block>
  );
});

Head.displayName = 'Head';

export default Head;

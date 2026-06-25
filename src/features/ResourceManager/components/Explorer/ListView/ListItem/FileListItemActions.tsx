import type { IAsyncTaskError } from '@lobechat/types';
import { Button, Flexbox, stopPropagation } from '@lobehub/ui';
import type { ItemType } from 'antd/es/menu/interface';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon } from 'lucide-react';
import { useMemo } from 'react';

import { useFileTransferMenuItem } from '@/business/client/hooks/useFileTransferMenuItem';
import { usePermission } from '@/hooks/usePermission';
import { getChunkTargetId } from '@/store/file';

import DropdownMenu from '../../ItemDropdown/DropdownMenu';
import ChunksBadge from './ChunkTag';
import { styles } from './styles';

interface FileListItemActionsProps {
  chunkCount?: number | null;
  chunkingError?: IAsyncTaskError | null;
  chunkingStatus?: unknown;
  embeddingError?: IAsyncTaskError | null;
  embeddingStatus?: unknown;
  fileId?: string | null;
  finishEmbedding?: boolean;
  id: string;
  isCreatingFileParseTask: boolean;
  isFolder: boolean;
  isPage: boolean;
  isSupportedForChunking: boolean;
  menuItems: ItemType[] | (() => ItemType[]);
  parseFiles: (ids: string[]) => void;
  t: any;
}

const isDeleteMenuItem = (item: ItemType) =>
  item !== null && 'key' in item && item.key === 'delete';

const isDividerMenuItem = (item: ItemType) =>
  item !== null && 'type' in item && item.type === 'divider';

export const appendTransferMenuItemsBeforeDelete = (
  baseItems: ItemType[],
  transferMenuItems: ItemType[] | null,
) => {
  if (!transferMenuItems || transferMenuItems.length === 0) return baseItems;

  const deleteIndex = baseItems.findIndex(isDeleteMenuItem);
  if (deleteIndex === -1) return [...baseItems, ...transferMenuItems];

  const insertIndex =
    deleteIndex > 0 && isDividerMenuItem(baseItems[deleteIndex - 1])
      ? deleteIndex - 1
      : deleteIndex;

  return [
    ...baseItems.slice(0, insertIndex),
    ...transferMenuItems,
    ...baseItems.slice(insertIndex),
  ];
};

const FileListItemActions = ({
  chunkCount,
  chunkingError,
  chunkingStatus,
  embeddingError,
  embeddingStatus,
  fileId,
  finishEmbedding,
  id,
  isCreatingFileParseTask,
  isFolder,
  isPage,
  isSupportedForChunking,
  menuItems,
  parseFiles,
  t,
}: FileListItemActionsProps) => {
  const { allowed: canEditResources } = usePermission('edit_own_content');
  const chunkTargetId = getChunkTargetId({ fileId, id });
  const transferMenuItems = useFileTransferMenuItem(
    id,
    isPage ? 'document' : isFolder ? 'folder' : 'file',
  );

  const mergedMenuItems = useMemo(() => {
    const baseItems = typeof menuItems === 'function' ? menuItems() : menuItems;
    return appendTransferMenuItemsBeforeDelete(baseItems, transferMenuItems);
  }, [menuItems, transferMenuItems]);

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={8}
      paddingInline={8}
      onClick={stopPropagation}
      onPointerDown={stopPropagation}
    >
      {!isFolder &&
        !isPage &&
        (isCreatingFileParseTask || isNull(chunkingStatus) || !chunkingStatus ? (
          canEditResources && (
            <div
              className={isCreatingFileParseTask ? undefined : styles.hover}
              title={t(
                isSupportedForChunking
                  ? 'FileManager.actions.chunkingTooltip'
                  : 'FileManager.actions.chunkingUnsupported',
              )}
            >
              <Button
                disabled={!isSupportedForChunking}
                icon={FileBoxIcon}
                loading={isCreatingFileParseTask}
                size={'small'}
                type={'text'}
                onClick={() => {
                  parseFiles([chunkTargetId]);
                }}
              >
                {t(
                  isCreatingFileParseTask
                    ? 'FileManager.actions.createChunkingTask'
                    : 'FileManager.actions.chunking',
                )}
              </Button>
            </div>
          )
        ) : (
          <div style={{ cursor: 'default' }}>
            <ChunksBadge
              chunkCount={chunkCount}
              chunkingError={chunkingError}
              chunkingStatus={chunkingStatus as any}
              embeddingError={embeddingError}
              embeddingStatus={embeddingStatus as any}
              finishEmbedding={finishEmbedding}
              id={chunkTargetId}
            />
          </div>
        ))}
      <DropdownMenu className={styles.hover} items={mergedMenuItems} />
    </Flexbox>
  );
};

export default FileListItemActions;

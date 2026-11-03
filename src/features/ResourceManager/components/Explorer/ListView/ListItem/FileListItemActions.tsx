import type { IAsyncTaskError } from '@lobechat/types';
import type { ItemType } from '@lobehub/ui';
import { Button, Flexbox, stopPropagation } from '@lobehub/ui';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { getChunkTargetId } from '@/store/file';

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
  /** The row's "…" menu, or a same-sized placeholder until the row is activated. */
  menu: ReactNode;
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
  menu,
  parseFiles,
  t,
}: FileListItemActionsProps) => {
  const { allowed: canEditResources } = usePermission('edit_own_content');
  const chunkTargetId = getChunkTargetId({ fileId, id });

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
          // Unsupported file types simply hide the entry instead of surfacing a
          // permanently disabled button.
          canEditResources &&
          isSupportedForChunking && (
            <div
              className={isCreatingFileParseTask ? undefined : styles.hover}
              title={t('FileManager.actions.chunkingTooltip')}
            >
              <Button
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
      {menu}
    </Flexbox>
  );
};

export default FileListItemActions;

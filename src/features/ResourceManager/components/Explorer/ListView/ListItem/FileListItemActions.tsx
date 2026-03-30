import type { IAsyncTaskError } from '@lobechat/types';
import { Button, Flexbox, stopPropagation } from '@lobehub/ui';
import type { ItemType } from 'antd/es/menu/interface';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon } from 'lucide-react';

import DropdownMenu from '../../ItemDropdown/DropdownMenu';
import ChunksBadge from './ChunkTag';
import { styles } from './styles';

interface FileListItemActionsProps {
  chunkCount?: number | null;
  chunkingError?: IAsyncTaskError | null;
  chunkingStatus?: unknown;
  embeddingError?: IAsyncTaskError | null;
  embeddingStatus?: unknown;
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

const FileListItemActions = ({
  chunkCount,
  chunkingError,
  chunkingStatus,
  embeddingError,
  embeddingStatus,
  finishEmbedding,
  id,
  isCreatingFileParseTask,
  isFolder,
  isPage,
  isSupportedForChunking,
  menuItems,
  parseFiles,
  t,
}: FileListItemActionsProps) => (
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
              parseFiles([id]);
            }}
          >
            {t(
              isCreatingFileParseTask
                ? 'FileManager.actions.createChunkingTask'
                : 'FileManager.actions.chunking',
            )}
          </Button>
        </div>
      ) : (
        <div style={{ cursor: 'default' }}>
          <ChunksBadge
            chunkCount={chunkCount}
            chunkingError={chunkingError}
            chunkingStatus={chunkingStatus as any}
            embeddingError={embeddingError}
            embeddingStatus={embeddingStatus as any}
            finishEmbedding={finishEmbedding}
            id={id}
          />
        </div>
      ))}
    <DropdownMenu className={styles.hover} items={menuItems} />
  </Flexbox>
);

export default FileListItemActions;

import { Button, Tooltip } from '@lobehub/ui';
import { Checkbox } from 'antd';
import { createStyles } from 'antd-style';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { isNull } from 'lodash-es';
import { FileBoxIcon } from 'lucide-react';
import { rgba } from 'polished';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';
import { useSearchParams } from 'react-router-dom';

import FileIcon from '@/components/FileIcon';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { FileListItem } from '@/types/files';
import { formatSize } from '@/utils/format';
import { isChunkingUnsupported } from '@/utils/isChunkingUnsupported';

import ChunksBadge from './ChunkTag';
import DropdownMenu from './DropdownMenu';

dayjs.extend(relativeTime);

export const FILE_DATE_WIDTH = 160;
export const FILE_SIZE_WIDTH = 140;

const useStyles = createStyles(({ css, token, cx, isDarkMode }) => {
  const hover = css`
    opacity: 0;
  `;
  return {
    checkbox: hover,
    container: css`
      cursor: pointer;
      margin-inline: 24px;
      border-block-end: 1px solid ${isDarkMode ? token.colorSplit : rgba(token.colorSplit, 0.06)};
      border-radius: ${token.borderRadius}px;

      &:hover {
        background: ${token.colorFillTertiary};

        .${cx(hover)} {
          opacity: 1;
        }
      }

      .chunk-tag {
        opacity: 1;
      }
    `,

    hover,
    item: css`
      padding-block: 0;
      padding-inline: 0 24px;
      color: ${token.colorTextSecondary};
    `,
    name: css`
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;

      margin-inline-start: 12px;

      color: ${token.colorText};
    `,
    selected: css`
      background: ${token.colorFillTertiary};

      &:hover {
        background: ${token.colorFillSecondary};
      }
    `,
  };
});

interface FileRenderItemProps extends FileListItem {
  index: number;
  knowledgeBaseId?: string;
  onSelectedChange: (id: string, selected: boolean, shiftKey: boolean, index: number) => void;
  selected?: boolean;
}

const FileRenderItem = memo<FileRenderItemProps>(
  ({
    size,
    chunkingError,
    embeddingError,
    embeddingStatus,
    finishEmbedding,
    chunkCount,
    url,
    name,
    fileType,
    id,
    createdAt,
    selected,
    chunkingStatus,
    onSelectedChange,
    knowledgeBaseId,
    index,
  }) => {
    const { t } = useTranslation('components');
    const { styles, cx } = useStyles();
    const [, setSearchParams] = useSearchParams();
    const [isCreatingFileParseTask, parseFiles] = useFileStore((s) => [
      fileManagerSelectors.isCreatingFileParseTask(id)(s),
      s.parseFilesToChunks,
    ]);

    const isSupportedForChunking = !isChunkingUnsupported(fileType);

    const displayTime =
      dayjs().diff(dayjs(createdAt), 'd') < 7
        ? dayjs(createdAt).fromNow()
        : dayjs(createdAt).format('YYYY-MM-DD');

    return (
      <Flexbox
        align={'center'}
        className={cx(styles.container, selected && styles.selected)}
        height={64}
        horizontal
        paddingInline={8}
      >
        <Flexbox
          align={'center'}
          className={styles.item}
          distribution={'space-between'}
          flex={1}
          horizontal
          onClick={() => {
            setSearchParams(
              (prev) => {
                const newParams = new URLSearchParams(prev);
                newParams.set('file', id);
                return newParams;
              },
              { replace: true },
            );
          }}
        >
          <Flexbox align={'center'} horizontal>
            <Center
              height={48}
              onClick={(e) => {
                e.stopPropagation();

                onSelectedChange(id, !selected, e.shiftKey, index);
              }}
              style={{ paddingInline: 4 }}
            >
              <Checkbox
                checked={selected}
                className={selected ? '' : styles.hover}
                style={{ borderRadius: '50%' }}
              />
            </Center>
            <FileIcon fileName={name} fileType={fileType} />
            <span className={styles.name}>{name}</span>
          </Flexbox>
          <Flexbox
            align={'center'}
            gap={8}
            horizontal
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {isCreatingFileParseTask || isNull(chunkingStatus) || !chunkingStatus ? (
              <div className={isCreatingFileParseTask ? undefined : styles.hover}>
                <Tooltip
                  styles={{
                    root: { pointerEvents: 'none' },
                  }}
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
                    onClick={() => {
                      parseFiles([id]);
                    }}
                    size={'small'}
                    type={'text'}
                  >
                    {t(
                      isCreatingFileParseTask
                        ? 'FileManager.actions.createChunkingTask'
                        : 'FileManager.actions.chunking',
                    )}
                  </Button>
                </Tooltip>
              </div>
            ) : (
              <div style={{ cursor: 'default' }}>
                <ChunksBadge
                  chunkCount={chunkCount}
                  chunkingError={chunkingError}
                  chunkingStatus={chunkingStatus}
                  embeddingError={embeddingError}
                  embeddingStatus={embeddingStatus}
                  finishEmbedding={finishEmbedding}
                  id={id}
                />
              </div>
            )}
            <div className={styles.hover}>
              <DropdownMenu filename={name} id={id} knowledgeBaseId={knowledgeBaseId} url={url} />
            </div>
          </Flexbox>
        </Flexbox>
        <Flexbox className={styles.item} width={FILE_DATE_WIDTH}>
          {displayTime}
        </Flexbox>
        <Flexbox className={styles.item} width={FILE_SIZE_WIDTH}>
          {formatSize(size)}
        </Flexbox>
      </Flexbox>
    );
  },
);

export default FileRenderItem;

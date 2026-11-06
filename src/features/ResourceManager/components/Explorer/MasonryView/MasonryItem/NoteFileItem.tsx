import { Button, stopPropagation, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { isChunkingSupported } from '@/libs/document-loaders/loaderType';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type AsyncTaskStatus, type IAsyncTaskError } from '@/types/asyncTask';

import ChunksBadge from '../../ListView/ListItem/ChunkTag';

const styles = stylex.create({
  floatingChunkBadge: {
    position: 'absolute',
    zIndex: 3,
    insetBlockEnd: '8px',
    insetInlineEnd: '8px',
    borderRadius: cssVar.borderRadius,
    // Revealed by the card's hover (the card carries `stylex.defaultMarker()`).
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1 },
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadow,
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  noteContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
    minHeight: '120px',
    padding: '16px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  notePreview: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '6',
    fontSize: '13px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
  },
  noteTitle: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '16px',
    fontWeight: cssVar.fontWeightStrong,
    lineHeight: 1.4,
    color: cssVar.colorText,
  },
});

interface NoteFileItemProps {
  chunkCount?: number | null;
  chunkingError?: IAsyncTaskError | null;
  chunkingStatus?: AsyncTaskStatus | null;
  contentPreview?: string | null;
  embeddingError?: IAsyncTaskError | null;
  embeddingStatus?: AsyncTaskStatus | null;
  fileType?: string;
  finishEmbedding?: boolean;
  id: string;
  metadata?: Record<string, any> | null;
  name: string;
}

const NoteFileItem = memo<NoteFileItemProps>(
  ({
    chunkCount,
    chunkingError,
    chunkingStatus,
    contentPreview,
    embeddingError,
    embeddingStatus,
    fileType,
    finishEmbedding,
    id,
    name,
    metadata,
  }) => {
    const { t } = useTranslation(['common', 'components', 'file']);
    const [isCreatingFileParseTask, parseFiles] = useFileStore((s) => [
      fileManagerSelectors.isCreatingFileParseTask(id)(s),
      s.parseFilesToChunks,
    ]);

    const isSupportedForChunking = isChunkingSupported({ fileType, name });

    const displayTitle = name || t('file:pageList.untitled');
    const emoji = metadata?.emoji;

    return (
      <>
        <div style={{ position: 'relative' }}>
          <div {...stylex.props(styles.noteContent)}>
            <div {...stylex.props(styles.noteTitle)}>
              {emoji && <span style={{ fontSize: 20 }}>{emoji}</span>}
              <span>{displayTitle}</span>
            </div>
            {contentPreview ? (
              <div {...stylex.props(styles.notePreview)}>{contentPreview}</div>
            ) : (
              <div {...stylex.props(styles.notePreview)}>
                <span style={{ color: 'var(--lobe-text-tertiary)', fontStyle: 'italic' }}>
                  {t('common:noContent')}
                </span>
              </div>
            )}
          </div>
        </div>
        {/* Floating chunk badge or action button */}
        {!isNull(chunkingStatus) && chunkingStatus ? (
          <div
            className={stylex.props(styles.floatingChunkBadge).className}
            onClick={stopPropagation}
          >
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
        ) : (
          isSupportedForChunking && (
            <Tooltip title={t('components:FileManager.actions.chunkingTooltip')}>
              <div
                className={stylex.props(styles.floatingChunkBadge).className}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isCreatingFileParseTask) {
                    parseFiles([id]);
                  }
                }}
              >
                <Button
                  icon={FileBoxIcon}
                  loading={isCreatingFileParseTask}
                  size={'small'}
                  type={'text'}
                />
              </div>
            </Tooltip>
          )
        )}
      </>
    );
  },
);

export default NoteFileItem;

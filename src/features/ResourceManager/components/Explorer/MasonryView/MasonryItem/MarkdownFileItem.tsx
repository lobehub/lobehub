import { Button, stopPropagation, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { isNull } from 'es-toolkit/compat';
import { FileBoxIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { isChunkingSupported } from '@/libs/document-loaders/loaderType';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { type AsyncTaskStatus, type IAsyncTaskError } from '@/types/asyncTask';
import { formatSize } from '@/utils/format';

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
  hoverOverlay: {
    position: 'absolute',
    zIndex: 1,
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    borderRadius: cssVar.borderRadiusLG,
    opacity: { 'default': 0, ':hover': 1 },
    backgroundColor: cssVar.colorBgMask,
    backgroundImage: 'none',
    transition: `opacity ${cssVar.motionDurationMid}`,
  },
  iconWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '120px',
    marginBlockEnd: '12px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  markdownPreview: {
    'position': 'relative',
    'overflow': 'hidden',
    'width': '100%',
    'minHeight': '120px',
    'maxHeight': '300px',
    'padding': '16px',
    'borderRadius': cssVar.borderRadiusLG,
    'fontSize': '13px',
    'lineHeight': 1.6,
    'color': cssVar.colorTextSecondary,
    'overflowWrap': 'break-word',
    'whiteSpace': 'pre-wrap',
    'backgroundColor': cssVar.colorFillQuaternary,
    'backgroundImage': 'none',
    '::after': {
      pointerEvents: 'none',
      content: "''",
      position: 'absolute',
      insetBlockEnd: 0,
      insetInline: 0,
      height: '60px',
      backgroundColor: 'transparent',
      backgroundImage: `linear-gradient(to bottom, transparent, ${cssVar.colorFillQuaternary})`,
    },
  },
  overlaySize: {
    fontSize: '12px',
    color: cssVar.colorTextLightSolid,
    opacity: 0.9,
  },
  overlayTitle: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '3',
    maxWidth: '100%',
    marginBlockEnd: '8px',
    fontSize: '14px',
    fontWeight: cssVar.fontWeightStrong,
    color: cssVar.colorTextLightSolid,
    textAlign: 'center',
    wordBreak: 'break-word',
  },
});

interface MarkdownFileItemProps {
  chunkCount?: number | null;
  chunkingError?: IAsyncTaskError | null;
  chunkingStatus?: AsyncTaskStatus | null;
  contentPreview?: string | null;
  embeddingError?: IAsyncTaskError | null;
  embeddingStatus?: AsyncTaskStatus | null;
  fileType?: string;
  finishEmbedding?: boolean;
  id: string;
  name: string;
  size: number;
}

const MarkdownFileItem = memo<MarkdownFileItemProps>(
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
    size,
  }) => {
    const { t } = useTranslation('components');
    const [isCreatingFileParseTask, parseFiles] = useFileStore((s) => [
      fileManagerSelectors.isCreatingFileParseTask(id)(s),
      s.parseFilesToChunks,
    ]);

    const isSupportedForChunking = isChunkingSupported({ fileType, name });

    return (
      <>
        <div style={{ position: 'relative' }}>
          {contentPreview ? (
            <div {...stylex.props(styles.markdownPreview)}>{contentPreview}</div>
          ) : (
            <div {...stylex.props(styles.iconWrapper)}>
              <FileIcon fileName={name} fileType={fileType} size={64} />
            </div>
          )}
          {/* Hover overlay */}
          <div {...stylex.props(styles.hoverOverlay)}>
            <div {...stylex.props(styles.overlayTitle)}>{name}</div>
            <div {...stylex.props(styles.overlaySize)}>{formatSize(size)}</div>
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
            <Tooltip title={t('FileManager.actions.chunkingTooltip')}>
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

export default MarkdownFileItem;

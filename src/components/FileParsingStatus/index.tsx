import { Button, Flexbox, Icon, Tag, Tooltip } from '@lobehub/ui';
import { Badge } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { BoltIcon, Loader2Icon, RotateCwIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsDark } from '@/hooks/useIsDark';
import { AsyncTaskStatus, type FileParsingTask } from '@/types/asyncTask';

import EmbeddingStatus from './EmbeddingStatus';

const styles = createStaticStyles(({ css }) => ({
  errorReason: css`
    padding: 4px;
    border-radius: 4px;

    font-family: monospace;
    font-size: 12px;

    background: var(--error-reason-bg, ${cssVar.colorText});
  `,
  errorReasonDark: css`
    --error-reason-bg: color-mix(in srgb, ${cssVar.colorText} 90%, black);
  `,
  errorReasonLight: css`
    --error-reason-bg: color-mix(in srgb, ${cssVar.colorText} 90%, white);
  `,
}));

interface FileParsingStatusProps extends FileParsingTask {
  className?: string;
  hideEmbeddingButton?: boolean;
  onClick?: (status: AsyncTaskStatus) => void;
  onEmbeddingClick?: () => void;
  onErrorClick?: (task: 'chunking' | 'embedding') => void;
  preparingEmbedding?: boolean;
}

const FileParsingStatus = memo<FileParsingStatusProps>(
  ({
    chunkingStatus,
    onEmbeddingClick,
    chunkingError,
    finishEmbedding,
    chunkCount,
    embeddingStatus,
    embeddingError,
    onClick,
    preparingEmbedding,
    onErrorClick,
    className,
    hideEmbeddingButton,
  }) => {
    const { t } = useTranslation(['components', 'common']);
    const isDarkMode = useIsDark();

    switch (chunkingStatus) {
      case AsyncTaskStatus.Processing: {
        return (
          <Tooltip
            styles={{ root: { pointerEvents: 'none' } }}
            title={t('FileParsingStatus.chunks.status.processingTip')}
          >
            <Tag className={className} color={'processing'} icon={<Badge status={'processing'} />}>
              {t('FileParsingStatus.chunks.status.processing')}
            </Tag>
          </Tooltip>
        );
      }

      case AsyncTaskStatus.Error: {
        return (
          <Tooltip
            styles={{ root: { maxWidth: 340, pointerEvents: 'none' } }}
            title={
              <Flexbox gap={4}>
                {t('FileParsingStatus.chunks.status.errorResult')}
                {chunkingError && (
                  <Flexbox
                    className={cx(
                      styles.errorReason,
                      isDarkMode ? styles.errorReasonDark : styles.errorReasonLight,
                    )}
                  >
                    [{chunkingError.name}]:{' '}
                    {chunkingError.body && typeof chunkingError.body !== 'string'
                      ? chunkingError.body.detail
                      : chunkingError.body}
                  </Flexbox>
                )}
              </Flexbox>
            }
          >
            <Tag className={className} color={'error'} variant={'filled'}>
              {t('FileParsingStatus.chunks.status.error')}{' '}
              <Icon
                icon={RotateCwIcon}
                onClick={() => {
                  onErrorClick?.('chunking');
                }}
                style={{ cursor: 'pointer' }}
                title={t('retry', { ns: 'common' })}
              />
            </Tag>
          </Tooltip>
        );
      }

      case AsyncTaskStatus.Success: {
        // if no embedding status, it means that the embedding is not started
        if (!embeddingStatus || preparingEmbedding)
          return (
            <Flexbox horizontal>
              <Tooltip
                styles={{ root: { pointerEvents: 'none' } }}
                title={t('FileParsingStatus.chunks.embeddingStatus.empty')}
              >
                <Tag
                  className={cx('chunk-tag', className)}
                  icon={
                    preparingEmbedding ? <Icon icon={Loader2Icon} spin /> : <Icon icon={BoltIcon} />
                  }
                  onClick={() => {
                    onClick?.(AsyncTaskStatus.Success);
                  }}
                  style={{ cursor: 'pointer' }}
                  variant={'filled'}
                >
                  {chunkCount}
                  {
                    // if want to hide button
                    hideEmbeddingButton ||
                    // or if preparing the embedding
                    preparingEmbedding ? null : (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEmbeddingClick?.();
                        }}
                        style={{
                          fontSize: 12,
                          height: 'auto',
                          paddingBlock: 0,
                          paddingInline: '8px 0',
                        }}
                        type={'link'}
                      >
                        {t('FileParsingStatus.chunks.embeddings')}
                      </Button>
                    )
                  }
                </Tag>
              </Tooltip>
            </Flexbox>
          );

        return (
          <EmbeddingStatus
            chunkCount={chunkCount}
            className={className}
            embeddingError={embeddingError}
            embeddingStatus={embeddingStatus}
            finishEmbedding={finishEmbedding}
            onClick={onClick}
            onErrorClick={onErrorClick}
          />
        );
      }
    }
  },
);

export default FileParsingStatus;

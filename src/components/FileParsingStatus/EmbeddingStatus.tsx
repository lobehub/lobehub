import { Flexbox, Icon, Tag, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { BoltIcon, RotateCwIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type FileParsingTask } from '@/types/asyncTask';
import { AsyncTaskStatus } from '@/types/asyncTask';

const styles = createStaticStyles(({ css, cssVar }) => ({
  errorReason: css`
    padding: 4px;
    border-radius: 4px;

    font-family: monospace;
    font-size: 12px;

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface EmbeddingStatusProps extends FileParsingTask {
  className?: string;
  onClick?: (status: AsyncTaskStatus) => void;
  onErrorClick?: (task: 'chunking' | 'embedding') => void;
}

const EmbeddingStatus = memo<EmbeddingStatusProps>(
  ({ chunkCount, embeddingStatus, embeddingError, onClick, onErrorClick, className }) => {
    const { t } = useTranslation(['components', 'common']);

    switch (embeddingStatus) {
      case AsyncTaskStatus.Processing: {
        return (
          <Flexbox horizontal>
            <Tooltip
              title={t('FileParsingStatus.chunks.embeddingStatus.processing')}
              styles={{
                root: { pointerEvents: 'none' },
              }}
            >
              <Tag
                className={cx('chunk-tag', className)}
                color={'processing'}
                icon={<Icon spin icon={BoltIcon} />}
                style={{ cursor: 'pointer' }}
                variant={'filled'}
              >
                {chunkCount}
              </Tag>
            </Tooltip>
          </Flexbox>
        );
      }

      case AsyncTaskStatus.Error: {
        return (
          <Tooltip
            styles={{
              root: { maxWidth: 340, pointerEvents: 'none' },
            }}
            title={
              <Flexbox gap={4}>
                {t('FileParsingStatus.chunks.embeddingStatus.errorResult')}
                {embeddingError && (
                  <Flexbox className={styles.errorReason}>
                    [{embeddingError.name}]:{' '}
                    {embeddingError.body && typeof embeddingError.body !== 'string'
                      ? embeddingError.body.detail
                      : embeddingError.body}
                  </Flexbox>
                )}
              </Flexbox>
            }
          >
            <Tag className={className} color={'error'} variant={'filled'}>
              {t('FileParsingStatus.chunks.embeddingStatus.error')}{' '}
              <Icon
                icon={RotateCwIcon}
                style={{ cursor: 'pointer' }}
                title={t('retry', { ns: 'common' })}
                onClick={() => {
                  onErrorClick?.('embedding');
                }}
              />
            </Tag>
          </Tooltip>
        );
      }

      case AsyncTaskStatus.Success: {
        return (
          <Flexbox horizontal>
            <Tooltip
              styles={{ root: { pointerEvents: 'none' } }}
              title={t('FileParsingStatus.chunks.embeddingStatus.success')}
            >
              <Tag
                className={cx('chunk-tag', className)}
                color={'purple'}
                icon={<Icon icon={BoltIcon} />}
                style={{ cursor: 'pointer' }}
                variant={'filled'}
                onClick={() => {
                  onClick?.(AsyncTaskStatus.Success);
                }}
              >
                {chunkCount}
              </Tag>
            </Tooltip>
          </Flexbox>
        );
      }
    }
  },
);

export default EmbeddingStatus;

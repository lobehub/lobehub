import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { RotateCwIcon, XIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FileUploadErrorActions } from '@/business/client/features/FileUploadErrorActions';
import FileIcon from '@/components/FileIcon';
import { useFileStore } from '@/store/file';
import { type UploadFileItem } from '@/types/files/upload';
import { formatSize, formatSpeed, formatTime } from '@/utils/format';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    cancelButton: css`
      opacity: 0;
      transition: opacity 0.2s ease;
    `,
    container: css`
      &:hover .cancel-button {
        opacity: 1;
      }
    `,
    progress: css`
      position: absolute;
      inset-block: 0;
      inset-inline: 0 1%;

      height: 100%;
      border-block-end: 3px solid ${cssVar.geekblue};

      background: ${cssVar.colorFillTertiary};
    `,
    title: css`
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;

      font-size: 15px;
      text-overflow: ellipsis;
    `,
  };
});

type UploadItemProps = UploadFileItem;

const UploadItem = memo<UploadItemProps>(({ error, errorCode, id, file, status, uploadState }) => {
  const { t } = useTranslation('file');
  const { type, name, size } = file;
  const cancelUpload = useFileStore((s) => s.cancelUpload);
  const retryDockUpload = useFileStore((s) => s.retryDockUpload);

  const desc: ReactNode = useMemo(() => {
    switch (status) {
      case 'uploading': {
        const textArray = [
          uploadState?.speed ? formatSpeed(uploadState.speed) : '',
          uploadState?.restTime
            ? t('uploadDock.body.item.restTime', {
                time: formatTime(uploadState?.restTime),
              })
            : '',
        ].filter(Boolean);

        return (
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {uploadState?.progress ? formatSize(size * (uploadState.progress / 100)) : '-'}/
            {formatSize(size)}
            {textArray.length === 0 ? '' : ' · ' + textArray.join(' · ')}
          </Text>
        );
      }
      case 'pending': {
        return (
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {formatSize(size)} · {t('uploadDock.body.item.pending')}
            {uploadState?.progress ? ` ${uploadState.progress}%` : ''}
          </Text>
        );
      }

      case 'processing': {
        return (
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {formatSize(size)} · {t('uploadDock.body.item.processing')}
          </Text>
        );
      }

      case 'success': {
        return (
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {formatSize(size)} · {t('uploadDock.body.item.done')}
          </Text>
        );
      }
      case 'error': {
        return (
          <Flexbox gap={6}>
            <Text style={{ fontSize: 12 }} type={'danger'}>
              {error || `${formatSize(size)} · ${t('uploadDock.body.item.error')}`}
            </Text>
            {errorCode ? <FileUploadErrorActions code={errorCode} /> : null}
          </Flexbox>
        );
      }
      case 'cancelled': {
        return (
          <Text style={{ fontSize: 12 }} type={'warning'}>
            {formatSize(size)} · {t('uploadDock.body.item.cancelled')}
          </Text>
        );
      }
      default: {
        return '';
      }
    }
  }, [error, errorCode, status, uploadState, size, t]);

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.container}
      gap={12}
      key={name}
      paddingBlock={8}
      paddingInline={12}
      style={{ position: 'relative' }}
    >
      <FileIcon fileName={name} fileType={type} size={36} />
      <Flexbox flex={1} style={{ overflow: 'hidden' }}>
        <div className={styles.title}>{name}</div>
        {desc}
      </Flexbox>

      {(status === 'uploading' || status === 'pending') && (
        <ActionIcon
          className={`${styles.cancelButton} cancel-button`}
          icon={XIcon}
          size="small"
          title={t('uploadDock.body.item.cancel')}
          onClick={() => {
            cancelUpload(id);
          }}
        />
      )}

      {status === 'error' && !errorCode ? (
        <ActionIcon
          icon={RotateCwIcon}
          size="small"
          title={t('uploadDock.body.item.retry')}
          onClick={() => {
            void retryDockUpload(id);
          }}
        />
      ) : null}

      {status === 'uploading' && !!uploadState && (
        <div
          className={styles.progress}
          style={{ insetInlineEnd: `${100 - uploadState.progress}%` }}
        />
      )}
    </Flexbox>
  );
});

export default UploadItem;

import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type ReactNode, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { type UploadFileItem } from '@/types/files/upload';
import { formatSize, formatSpeed, formatTime } from '@/utils/format';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    progress: css`
      position: absolute;
      inset-block: 0 0;
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

const UploadItem = memo<UploadItemProps>(({ file, status, uploadState }) => {
  const { t } = useTranslation('file');
  const { type, name, size } = file;

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
          <Text style={{ fontSize: 12 }} type={'danger'}>
            {formatSize(size)} · {t('uploadDock.body.item.error')}
          </Text>
        );
      }
      default: {
        return '';
      }
    }
  }, [status, uploadState]);

  return (
    <Flexbox
      align={'center'}
      gap={4}
      horizontal
      key={name}
      paddingBlock={8}
      paddingInline={12}
      style={{ position: 'relative' }}
    >
      <FileIcon fileName={name} fileType={type} />
      <Flexbox style={{ overflow: 'hidden' }}>
        <div className={styles.title}>{name}</div>
        {desc}
      </Flexbox>

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

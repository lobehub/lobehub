import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import { ActionIcon, Tag } from '@lobehub/ui/base-ui';
import { Progress } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon, RotateCwIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FileUploadErrorActions } from '@/business/client/features/FileUploadErrorActions';
import { useEventCallback } from '@/hooks/useEventCallback';
import { useFileStore } from '@/store/file';
import { type UploadFileItem } from '@/types/files/upload';

import UploadDetail from '../../../components/UploadDetail';
import Content from './Content';
import { openFilePreviewModal } from './FilePreviewModal.loader';
import { useUploadCompletion } from './useUploadCompletion';
import { getFileBasename, getUploadChipSize, getUploadChipState } from './utils';

const styles = createStaticStyles(({ css }) => ({
  chip: css`
    max-width: 100%;
    height: 28px;
  `,
  content: css`
    display: flex;
    gap: 4px;
    align-items: center;

    min-width: 0;
    max-width: 380px;
  `,
  size: css`
    flex-shrink: 0;

    font-variant-numeric: tabular-nums;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  thumbnail: css`
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    line-height: 0;
  `,
  statusIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 12px;
    height: 12px;

    line-height: 0;
  `,
  name: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

type FileItemProps = UploadFileItem;

const ContextItem = memo<FileItemProps>((props) => {
  const { error, errorCode, file, id, status, tasks, uploadState } = props;
  const { t } = useTranslation(['chat', 'common']);
  const removeChatUploadFile = useFileStore((s) => s.removeChatUploadFile);
  const retryChatUploadFile = useFileStore((s) => s.retryChatUploadFile);
  const { busy, canPreview, canRetry, indicator, progress } = getUploadChipState(props);
  const basename = getFileBasename(file.name);
  const sizeLabel = getUploadChipSize(props);
  const showCompletion = useUploadCompletion(status);

  const handleClick = useEventCallback(() => {
    if (canPreview) void openFilePreviewModal(props);
  });
  const handleClose = useEventCallback(() => {
    void removeChatUploadFile(id);
  });

  const detail = (
    <Flexbox gap={4}>
      <span>{file.name}</span>
      {status === 'error' && error ? (
        <Flexbox horizontal align={'flex-start'} gap={4} style={{ color: cssVar.colorError }}>
          <Flexbox align={'center'} justify={'center'} style={{ height: '1lh' }}>
            <Icon icon={CircleAlertIcon} size={12} />
          </Flexbox>
          <span>{error}</span>
        </Flexbox>
      ) : (
        <UploadDetail size={file.size} status={status} tasks={tasks} uploadState={uploadState} />
      )}
    </Flexbox>
  );

  return (
    <Tag
      closable
      aria-busy={busy}
      className={styles.chip}
      size={'large'}
      onClick={canPreview ? handleClick : undefined}
      onClose={handleClose}
    >
      <Tooltip title={detail}>
        <Flexbox horizontal align={'center'} className={styles.content}>
          <Flexbox className={styles.thumbnail}>
            <Content {...props} />
          </Flexbox>
          <span className={styles.name}>{basename}</span>
          {(indicator !== 'file' || showCompletion) && (
            <Flexbox className={styles.statusIcon}>
              {showCompletion ? (
                <Icon
                  aria-label={t('upload.preview.status.success')}
                  icon={CircleCheckIcon}
                  size={12}
                  style={{ color: cssVar.colorSuccess }}
                />
              ) : indicator === 'loading' ? (
                <Icon
                  spin
                  icon={Loader2Icon}
                  size={12}
                  aria-label={t(
                    status === 'processing'
                      ? 'upload.preview.status.processing'
                      : status === 'pending'
                        ? 'upload.preview.status.pending'
                        : 'upload.preview.status.uploading',
                  )}
                />
              ) : indicator === 'progress' ? (
                <span
                  aria-label={t('upload.preview.status.uploading')}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={progress}
                  className={styles.statusIcon}
                  role={'progressbar'}
                >
                  <Progress
                    percent={progress}
                    showInfo={false}
                    size={12}
                    status={'normal'}
                    strokeWidth={12}
                    type={'circle'}
                  />
                </span>
              ) : (
                <Icon icon={CircleAlertIcon} size={12} style={{ color: cssVar.colorError }} />
              )}
            </Flexbox>
          )}
          {sizeLabel && <span className={styles.size}>{sizeLabel}</span>}
        </Flexbox>
      </Tooltip>
      {canRetry && (
        <Flexbox horizontal onClick={(event) => event.stopPropagation()}>
          {errorCode ? (
            <FileUploadErrorActions compact code={errorCode} />
          ) : (
            <ActionIcon
              icon={RotateCwIcon}
              size={{ blockSize: 24, size: 12 }}
              title={t('retry', { ns: 'common' })}
              onClick={() => {
                void retryChatUploadFile(id);
              }}
            />
          )}
        </Flexbox>
      )}
    </Tag>
  );
});

export default ContextItem;

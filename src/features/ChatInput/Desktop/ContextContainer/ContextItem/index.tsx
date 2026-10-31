import { ActionIcon, Flexbox, Icon, Progress, Tag, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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

const styles = stylex.create({
  chip: { maxWidth: '100%', height: '28px' },
  content: { display: 'flex', gap: '4px', alignItems: 'center', minWidth: '0', maxWidth: '380px' },
  size: {
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
    whiteSpace: 'nowrap',
  },
  thumbnail: { flexShrink: 0, width: '20px', height: '20px', lineHeight: 0 },
  statusIcon: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: '12px',
    height: '12px',
    lineHeight: 0,
  },
  errorText: { userSelect: 'text' },
  name: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '0',
    lineHeight: '18px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

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
          <span {...stylex.props(styles.errorText)}>{error}</span>
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
      className={stylex.props(styles.chip).className}
      size={'large'}
      onClick={canPreview ? handleClick : undefined}
      onClose={handleClose}
    >
      <Tooltip title={detail}>
        <Flexbox horizontal align={'center'} className={stylex.props(styles.content).className}>
          <Flexbox className={stylex.props(styles.thumbnail).className}>
            <Content {...props} />
          </Flexbox>
          <span {...stylex.props(styles.name)}>{basename}</span>
          {(indicator !== 'file' || showCompletion) && (
            <Flexbox className={stylex.props(styles.statusIcon).className}>
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
                  {...stylex.props(styles.statusIcon)}
                  role={'progressbar'}
                >
                  <Progress
                    percent={progress ?? 0}
                    showInfo={false}
                    size={12}
                    status={'normal'}
                    type={'circle'}
                  />
                </span>
              ) : (
                <Icon icon={CircleAlertIcon} size={12} style={{ color: cssVar.colorError }} />
              )}
            </Flexbox>
          )}
          {sizeLabel && <span {...stylex.props(styles.size)}>{sizeLabel}</span>}
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

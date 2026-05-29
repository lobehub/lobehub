import { ActionIcon } from '@lobehub/ui';
import { Upload } from 'antd';
import { Paperclip } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface AttachmentUploadButtonProps {
  accept?: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
  size?: number;
  title?: string;
}

/**
 * Standalone "attach file" button — Antd Upload wrapped in a paperclip icon.
 * Calls `onFiles` for each batch of files the user picks. The host decides
 * what to do with them (typically pass to `useAttachmentUpload.addFiles`).
 */
const AttachmentUploadButton = memo<AttachmentUploadButtonProps>(
  ({ accept, disabled, onFiles, size = 20, title }) => {
    const { t } = useTranslation('chat');

    return (
      <Upload
        multiple
        accept={accept}
        disabled={disabled}
        showUploadList={false}
        beforeUpload={(file, fileList) => {
          // beforeUpload fires once per file but receives the whole batch.
          // Forward all files on the LAST call to give onFiles one shot.
          if (file === fileList.at(-1)) {
            void onFiles(fileList);
          }
          return false;
        }}
      >
        <ActionIcon
          disabled={disabled}
          icon={Paperclip}
          size={{ blockSize: size + 8, size }}
          title={title ?? t('upload.action.tooltip')}
        />
      </Upload>
    );
  },
);

export default AttachmentUploadButton;

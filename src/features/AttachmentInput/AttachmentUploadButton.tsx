import { ActionIcon, Upload } from '@lobehub/ui/base-ui';
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

const AttachmentUploadButton = memo<AttachmentUploadButtonProps>(
  ({ accept, disabled, onFiles, size = 20, title }) => {
    const { t } = useTranslation('chat');

    return (
      <Upload multiple accept={accept} disabled={disabled} onFiles={(files) => void onFiles(files)}>
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

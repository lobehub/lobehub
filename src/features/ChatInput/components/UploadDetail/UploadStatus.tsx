import { CheckCircleFilled } from '@ant-design/icons';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { CircleAlertIcon, Loader2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type FileUploadState, type FileUploadStatus } from '@/types/files/upload';
import { formatSize } from '@/utils/format';

interface UploadStateProps {
  error?: string;
  size: number;
  status: FileUploadStatus;
  uploadState?: FileUploadState;
}

const UploadStatus = memo<UploadStateProps>(({ error, status, size, uploadState }) => {
  const { t } = useTranslation('chat');

  switch (status) {
    default:
    case 'pending': {
      return (
        <Flexbox horizontal align={'center'} gap={4}>
          <Icon spin icon={Loader2Icon} size={12} />
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('upload.preview.status.pending')}
          </Text>
        </Flexbox>
      );
    }

    case 'uploading': {
      return (
        <Flexbox horizontal align={'center'} gap={4}>
          <Progress percent={uploadState?.progress} size={14} type="circle" />
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {formatSize(size * ((uploadState?.progress || 0) / 100), 0)}
          </Text>
        </Flexbox>
      );
    }

    case 'processing': {
      return (
        <Flexbox horizontal align={'center'} gap={4}>
          <Progress percent={uploadState?.progress} size={14} type="circle" />
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {formatSize(size)}
          </Text>
        </Flexbox>
      );
    }

    case 'success': {
      return (
        <Flexbox horizontal align={'center'} gap={4}>
          <CheckCircleFilled style={{ color: cssVar.colorSuccess, fontSize: 12 }} />
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {formatSize(size)}
          </Text>
        </Flexbox>
      );
    }

    case 'error': {
      return (
        <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
          <Icon icon={CircleAlertIcon} size={12} style={{ color: cssVar.colorError }} />
          <Text
            ellipsis={{ tooltip: error }}
            style={{ color: cssVar.colorError, fontSize: 12, maxWidth: 110 }}
          >
            {error || t('upload.preview.status.error')}
          </Text>
        </Flexbox>
      );
    }

    case 'cancelled': {
      return (
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {t('upload.preview.status.cancelled')}
        </Text>
      );
    }
  }
});

export default UploadStatus;

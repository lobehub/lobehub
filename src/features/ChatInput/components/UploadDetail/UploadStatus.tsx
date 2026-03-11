import { CheckCircleFilled } from '@ant-design/icons';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type FileUploadState, type FileUploadStatus } from '@/types/files/upload';
import { formatSize } from '@/utils/format';

interface UploadStateProps {
  size: number;
  status: FileUploadStatus;
  uploadState?: FileUploadState;
}

const UploadStatus = memo<UploadStateProps>(({ status, size, uploadState }) => {
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
  }
});

export default UploadStatus;

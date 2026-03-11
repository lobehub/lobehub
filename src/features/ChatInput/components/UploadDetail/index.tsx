import { Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileParsingStatus from '@/components/FileParsingStatus';
import { type FileParsingTask } from '@/types/asyncTask';
import { type FileUploadState, type FileUploadStatus } from '@/types/files';

import UploadStatus from './UploadStatus';

const styles = createStaticStyles(({ css }) => ({
  status: css`
    &.ant-tag {
      padding-inline: 0;
      background: none;
    }
  `,
}));

interface UploadDetailProps {
  size: number;
  status: FileUploadStatus;
  tasks?: FileParsingTask;
  uploadState?: FileUploadState;
}

const UploadDetail = memo<UploadDetailProps>(({ uploadState, status, size, tasks }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox horizontal align={'center'} gap={8} height={22}>
      <UploadStatus size={size} status={status} uploadState={uploadState} />
      {!!tasks && Object.keys(tasks).length === 0 ? (
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {t('upload.preview.prepareTasks')}
        </Text>
      ) : (
        <div>
          <FileParsingStatus {...tasks} hideEmbeddingButton className={styles.status} />
        </div>
      )}
    </Flexbox>
  );
});

export default UploadDetail;

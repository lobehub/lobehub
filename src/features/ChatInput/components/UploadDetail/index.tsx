import { Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileParsingStatus from '@/components/FileParsingStatus';
import { type FileParsingTask } from '@/types/asyncTask';
import { type FileUploadState, type FileUploadStatus } from '@/types/files';

import UploadStatus from './UploadStatus';

const styles = stylex.create({
  status: { paddingInline: '0', backgroundColor: 'transparent', backgroundImage: 'none' },
});

interface UploadDetailProps {
  error?: string;
  size: number;
  status: FileUploadStatus;
  tasks?: FileParsingTask;
  uploadState?: FileUploadState;
}

const UploadDetail = memo<UploadDetailProps>(({ error, uploadState, status, size, tasks }) => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox horizontal align={'center'} gap={8} height={22}>
      <UploadStatus error={error} size={size} status={status} uploadState={uploadState} />
      {!!tasks && Object.keys(tasks).length === 0 ? (
        <Text style={{ fontSize: 12 }} type={'secondary'}>
          {t('upload.preview.prepareTasks')}
        </Text>
      ) : (
        <div>
          <FileParsingStatus
            {...tasks}
            hideEmbeddingButton
            className={stylex.props(styles.status).className}
          />
        </div>
      )}
    </Flexbox>
  );
});

export default UploadDetail;

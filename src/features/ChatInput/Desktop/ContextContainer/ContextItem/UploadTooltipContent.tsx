import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleAlertIcon } from 'lucide-react';
import { memo } from 'react';

import { type UploadFileItem } from '@/types/files/upload';

import UploadDetail from '../../../components/UploadDetail';

const styles = stylex.create({
  errorText: { userSelect: 'text' },
});

/** File name plus upload progress, or the failure reason, shown on hover of an upload. */
const UploadTooltipContent = memo<UploadFileItem>(({ error, file, status, tasks, uploadState }) => (
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
));

UploadTooltipContent.displayName = 'UploadTooltipContent';

export default UploadTooltipContent;

import type { MeetingStatus } from '@lobechat/types';
import { Tag } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

const STATUS_COLOR: Record<MeetingStatus, string | undefined> = {
  failed: 'error',
  paused: 'warning',
  ready: 'success',
  recording: 'red',
  summarizing: 'processing',
  transcribing: 'processing',
  uploading: 'processing',
};

const MeetingStatusTag = ({ status }: { status: MeetingStatus }) => {
  const { t } = useTranslation('meeting');

  return (
    <Tag color={STATUS_COLOR[status]} size={'small'}>
      {t(`status.${status}`)}
    </Tag>
  );
};

export default MeetingStatusTag;

import { ActionIcon, toast } from '@lobehub/ui';
import { CircleStopIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { stopActivity } from './state';

export default function StopButton({ rootId }: { rootId: string }) {
  const { t } = useTranslation('chat');
  const [stopping, setStopping] = useState(false);
  return (
    <ActionIcon
      danger
      icon={CircleStopIcon}
      loading={stopping}
      size={'small'}
      title={t('backgroundActivity.stop')}
      onClick={async (event) => {
        event.stopPropagation();
        setStopping(true);
        try {
          await stopActivity(rootId);
        } catch (error) {
          console.error(error);
          toast.error(t('backgroundActivity.stopFailed'));
        } finally {
          setStopping(false);
        }
      }}
    />
  );
}

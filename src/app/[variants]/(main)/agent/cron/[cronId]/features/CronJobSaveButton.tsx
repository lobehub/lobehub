'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { Save } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface CronJobSaveButtonProps {
  disabled?: boolean;
  loading?: boolean;
  onSave: () => void;
}

const CronJobSaveButton = memo<CronJobSaveButtonProps>(({ disabled, loading, onSave }) => {
  const { t } = useTranslation('setting');

  return (
    <Flexbox paddingBlock={8}>
      <Button
        disabled={disabled}
        icon={Save}
        loading={loading}
        style={{ maxWidth: 200, width: '100%' }}
        type="primary"
        onClick={onSave}
      >
        {t('agentCronJobs.saveAsNew')}
      </Button>
    </Flexbox>
  );
});

export default CronJobSaveButton;

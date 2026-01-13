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
    <Flexbox paddingBlock={16}>
      <Button
        disabled={disabled}
        icon={Save}
        loading={loading}
        onClick={onSave}
        style={{ width: 200 }}
        type="primary"
      >
        {t('agentCronJobs.saveAsNew', { defaultValue: 'Save as New Scheduled Task' })}
      </Button>
    </Flexbox>
  );
});

export default CronJobSaveButton;

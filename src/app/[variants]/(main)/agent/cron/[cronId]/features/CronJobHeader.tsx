import { Flexbox, Input } from '@lobehub/ui';
import { Switch } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface CronJobHeaderProps {
  enabled?: boolean;
  isNewJob?: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onToggleEnabled?: (enabled: boolean) => void;
}

const CronJobHeader = memo<CronJobHeaderProps>(
  ({ enabled, isNewJob, name, onNameChange, onToggleEnabled }) => {
    const { t } = useTranslation(['setting', 'common']);

    return (
      <Flexbox gap={16}>
        {/* Title Input */}
        <Input
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('agentCronJobs.form.name.placeholder')}
          style={{
            fontSize: 28,
            fontWeight: 600,
            padding: 0,
          }}
          value={name}
          variant={'borderless'}
        />

        {/* Controls Row */}
        {!isNewJob && (
          <Flexbox align="center" gap={12} horizontal>
            {/* Enable/Disable Switch */}
            <Switch checked={enabled ?? false} onChange={onToggleEnabled} />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default CronJobHeader;

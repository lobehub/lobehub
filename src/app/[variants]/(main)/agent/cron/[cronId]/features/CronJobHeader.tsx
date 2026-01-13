import { ActionIcon, Flexbox, Input, Text } from '@lobehub/ui';
import { Switch } from 'antd';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface CronJobHeaderProps {
  enabled?: boolean;
  isNewJob?: boolean;
  name: string;
  onDelete?: () => void;
  onNameChange: (name: string) => void;
  onToggleEnabled?: (enabled: boolean) => void;
}

const CronJobHeader = memo<CronJobHeaderProps>(
  ({ enabled, isNewJob, name, onDelete, onNameChange, onToggleEnabled }) => {
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
          <Flexbox align="center" gap={24} horizontal>
            {/* Left: Enable/Disable Switch */}
            <Flexbox align="center" gap={12} horizontal>
              <Switch checked={enabled ?? false} onChange={onToggleEnabled} />
              <Text type="secondary">
                {t(enabled ? 'agentCronJobs.status.enabled' : 'agentCronJobs.status.disabled')}
              </Text>
            </Flexbox>

            {/* Right: Delete Button */}
            <ActionIcon icon={Trash2} onClick={onDelete} title={t('delete', { ns: 'common' })} />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default CronJobHeader;

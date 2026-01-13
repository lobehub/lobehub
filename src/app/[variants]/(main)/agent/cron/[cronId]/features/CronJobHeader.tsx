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
      <Flexbox align="center" gap={16} horizontal justify="space-between">
        <Flexbox gap={6} style={{ flex: 1, minWidth: 0 }}>
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
        </Flexbox>

        {!isNewJob && (
          <Flexbox align="center" gap={8} horizontal>
            <ActionIcon
              icon={Trash2}
              onClick={onDelete}
              size={'small'}
              title={t('delete', { ns: 'common' })}
            />
            <Text type="secondary">
              {t(enabled ? 'agentCronJobs.status.enabled' : 'agentCronJobs.status.disabled')}
            </Text>
            <Switch checked={enabled ?? false} onChange={onToggleEnabled} size="small" />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default CronJobHeader;

'use client';

import { Flexbox, Input, LobeSwitch as Switch } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  titleInput: css`
    flex: 1;
    font-size: 28px;
    font-weight: 500;
    line-height: 1.4;
  `,
}));

interface CronJobHeaderProps {
  enabled?: boolean;
  isNewJob?: boolean;
  isTogglingEnabled?: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onToggleEnabled?: (enabled: boolean) => void;
}

const CronJobHeader = memo<CronJobHeaderProps>(
  ({ enabled, isNewJob, isTogglingEnabled, name, onNameChange, onToggleEnabled }) => {
    const { t } = useTranslation(['setting', 'common']);

    return (
      <Flexbox
        horizontal
        align="center"
        gap={16}
        justify="space-between"
        style={{ marginBottom: 8 }}
      >
        <Input
          className={styles.titleInput}
          placeholder={t('agentCronJobs.form.name.placeholder')}
          value={name}
          variant="borderless"
          onChange={(e) => onNameChange(e.target.value)}
        />
        {!isNewJob && (
          <Switch
            checked={enabled ?? false}
            loading={isTogglingEnabled}
            onChange={onToggleEnabled}
          />
        )}
      </Flexbox>
    );
  },
);

export default CronJobHeader;

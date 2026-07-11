'use client';

import { type ComposioAppType } from '@lobechat/const';
import { Flexbox, Text } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import ServerIcon from './ServerIcon';
import { styles } from './style';
import { useConnectAppToggle } from './useConnectAppToggle';

interface AppRowProps {
  app: ComposioAppType;
  description: string;
}

const AppRow = memo<AppRowProps>(({ app, description }) => {
  const { checked, loading, onToggle } = useConnectAppToggle({
    appSlug: app.appSlug,
    identifier: app.identifier,
    label: app.label,
  });

  return (
    <Flexbox horizontal align={'center'} className={styles.row} gap={12} justify={'space-between'}>
      <Flexbox horizontal align={'center'} flex={1} gap={12} style={{ overflow: 'hidden' }}>
        <ServerIcon icon={app.icon} label={app.label} />
        <Flexbox gap={2} style={{ overflow: 'hidden' }}>
          <Text className={styles.rowLabel}>{app.label}</Text>
          <Text className={styles.description}>{description}</Text>
        </Flexbox>
      </Flexbox>
      <Switch checked={checked} loading={loading} onChange={onToggle} />
    </Flexbox>
  );
});

AppRow.displayName = 'AppRow';

export default AppRow;

'use client';

import { Flexbox, Spin, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

import { formatElapsedTime } from './utils';

const styles = stylex.create({ container: { paddingBlock: '12px' } });

const InitializingState = memo(() => {
  const { t } = useTranslation('chat');
  const [elapsedTime, setElapsedTime] = useState(0);

  // Timer for updating elapsed time every second
  useEffect(() => {
    const startTime = Date.now();

    const timer = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={12}>
      <Flexbox horizontal align="center" gap={8}>
        <Spin size="small" variant="network" />
        <Text className={shinyTextStyles.shinyText} weight={500}>
          {t('task.status.initializing')}
        </Text>
        <Text type="secondary">({formatElapsedTime(elapsedTime)})</Text>
      </Flexbox>
    </Flexbox>
  );
});

InitializingState.displayName = 'InitializingState';

export default InitializingState;

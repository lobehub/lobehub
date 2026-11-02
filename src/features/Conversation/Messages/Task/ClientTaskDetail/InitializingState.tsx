'use client';

import { Flexbox, Spin, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { shinyTextStyles } from '@/styles';

const styles = stylex.create({ container: { paddingBlock: '12px' } });

const InitializingState = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <Flexbox className={stylex.props(styles.container).className} gap={12}>
      <Flexbox horizontal align="center" gap={8}>
        <Spin size="small" variant="network" />
        <Text className={shinyTextStyles.shinyText} weight={500}>
          {t('task.status.initializing')}
        </Text>
      </Flexbox>
    </Flexbox>
  );
});

InitializingState.displayName = 'InitializingState';

export default InitializingState;

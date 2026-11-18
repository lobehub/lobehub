'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    paddingBlockStart: 56,
    paddingBlockEnd: 32,
    paddingInline: 32,
  },
  form: { width: '100%', maxWidth: 760 },
});

/**
 * Lobe Bench settings. A benchmark fixes its judge and run rules (attempts per
 * case, step limit, timeout) when it is made, so nothing here changes how runs
 * are graded or run; what is left is where the mock connections are managed.
 */
const LobeBenchSettings = memo(() => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox className={stylex.props(styles.container).className} flex={1}>
      <Flexbox className={stylex.props(styles.form).className} gap={24}>
        <Flexbox gap={4}>
          <Text as={'h1'} fontSize={24} weight={600}>
            {t('lobeBench.settings.title')}
          </Text>
          <Text type={'secondary'}>{t('lobeBench.settings.subtitle')}</Text>
        </Flexbox>
        <Block padding={16} variant="outlined">
          <Flexbox gap={8}>
            <Text weight={600}>{t('connections.title')}</Text>
            <Text type="secondary">{t('connections.settingsHint')}</Text>
            <WorkspaceLink to="/settings/connector">{t('connections.openManager')}</WorkspaceLink>
          </Flexbox>
        </Block>
      </Flexbox>
    </Flexbox>
  );
});

LobeBenchSettings.displayName = 'LobeBenchSettings';

export default LobeBenchSettings;

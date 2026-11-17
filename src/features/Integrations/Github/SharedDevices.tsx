'use client';

import { Block, Flexbox, Icon, Switch, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ServerIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import GrantLog from './GrantLog';
import { useRequesterCredentialPolicy } from './useSharedDeviceCredential';

const styles = stylex.create({
  card: {
    paddingBlock: 12,
    paddingInline: 16,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  icon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
  },
});

const SharedDevices = memo(() => {
  const { t } = useTranslation('integration');
  const { policy, toggle } = useRequesterCredentialPolicy(() =>
    toast.error(t('github.sharedDevices.updateFailed')),
  );

  return (
    <>
      <Flexbox gap={10}>
        <Flexbox gap={4}>
          <Text strong style={{ fontSize: 16 }}>
            {t('github.sharedDevices.title')}
          </Text>
          <Text type="secondary">{t('github.sharedDevices.description')}</Text>
        </Flexbox>
        <Block {...stylex.props(styles.card)} variant={'filled'}>
          <Flexbox horizontal align="center" gap={14}>
            <span {...stylex.props(styles.icon)}>
              <Icon icon={ServerIcon} size={16} />
            </span>
            <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
              <Text strong>{t('github.sharedDevices.toggle.title')}</Text>
              <Text style={{ fontSize: 13 }} type="secondary">
                {t('github.sharedDevices.toggle.description')}
              </Text>
              {policy && !policy.canEdit ? (
                <Text style={{ fontSize: 12 }} type="secondary">
                  {t('github.sharedDevices.adminOnly')}
                </Text>
              ) : null}
            </Flexbox>
            <Switch
              checked={policy?.enabled ?? false}
              disabled={!policy?.canEdit}
              style={{ flex: 'none' }}
              onChange={(next: boolean) => void toggle(next)}
            />
          </Flexbox>
        </Block>
      </Flexbox>
      <GrantLog isAdmin={!!policy?.canEdit} />
    </>
  );
});

SharedDevices.displayName = 'GithubIntegrationSharedDevices';

export default SharedDevices;

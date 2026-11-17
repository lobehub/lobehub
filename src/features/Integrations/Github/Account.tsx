'use client';

import { Avatar, Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { UserRoundIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { githubAccountState, useDisconnectGithubAccount } from './useSharedDeviceCredential';

const styles = stylex.create({
  card: {
    paddingBlock: 12,
    paddingInline: 16,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
  },
  placeholder: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: '50%',
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillTertiary,
  },
});

interface AccountProps {
  authorizeHref?: string;
  identity: {
    avatarUrl: string | null;
    externalLogin: string;
    needsReauthorization: boolean;
  } | null;
  onChange?: () => void;
}

const Account = memo<AccountProps>(({ authorizeHref, identity, onChange }) => {
  const { t } = useTranslation('integration');

  const disconnect = useDisconnectGithubAccount(onChange);
  const state = githubAccountState(identity);

  return (
    <Flexbox gap={10}>
      <Flexbox gap={4}>
        <Text strong style={{ fontSize: 16 }}>
          {t('github.account.title')}
        </Text>
        <Text type="secondary">{t('github.account.description')}</Text>
      </Flexbox>
      <Block {...stylex.props(styles.card)} variant={'filled'}>
        <Flexbox horizontal align="center" gap={12}>
          {identity ? (
            <Avatar
              avatar={identity.avatarUrl ?? undefined}
              size={32}
              title={identity.externalLogin}
            />
          ) : (
            <span {...stylex.props(styles.placeholder)}>
              <Icon icon={UserRoundIcon} size={16} />
            </span>
          )}
          <Text style={{ flex: 1, minWidth: 0 }} type={state === 'ready' ? undefined : 'secondary'}>
            {identity
              ? t(
                  state === 'reauthorize'
                    ? 'github.account.needsReauthorization'
                    : 'github.account.connected',
                  { login: identity.externalLogin },
                )
              : t('github.account.notConnected')}
          </Text>
          {state !== 'ready' && (
            <Button disabled={!authorizeHref} href={authorizeHref} size="small" type="primary">
              {state === 'reauthorize'
                ? t('github.account.reconnect')
                : t('github.account.connect')}
            </Button>
          )}
          {identity && (
            <Button size="small" onClick={disconnect}>
              {t('github.account.disconnect')}
            </Button>
          )}
        </Flexbox>
      </Block>
    </Flexbox>
  );
});

Account.displayName = 'GithubIntegrationAccount';

export default Account;

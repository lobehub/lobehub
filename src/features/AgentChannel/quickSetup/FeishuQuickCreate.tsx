'use client';

import { Button, CopyButton, Flexbox, Icon, QRCode, Spin, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { agentBotProviderService } from '@/services/agentBotProvider';

import { registrationPollInterval, scanCopyKey, tolerateTransientPollFailure } from './links';
import { type FeishuCreatedApp, useCreatedAppSave } from './useCreatedAppSave';

export type { FeishuCreatedApp } from './useCreatedAppSave';

const QR_SIZE = 148;

const styles = stylex.create({
  qrSlot: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    // QR_SIZE + 16
    width: '164px',
    height: '164px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: '#fff',
    backgroundImage: 'none',
  },
});

interface FeishuQuickCreateProps {
  appPreset?: { avatar?: string; desc?: string; name?: string };
  /** Saves the created app; rejects (with a message) when it can't be saved. */
  onCreated: (app: FeishuCreatedApp) => Promise<void>;
  platform: 'feishu' | 'lark';
  /** Who the app is for (the agent id); part of the session key so it isn't shared. */
  scope?: string;
}

type Brand = FeishuCreatedApp['brand'];

/**
 * Feishu / Lark scan-to-create: one scan creates the bot app with messaging
 * scopes and the receive-message event already set, and hands back its
 * credentials. Polls while waiting; an expired or declined code regenerates.
 * When saving the created app fails, its credentials stay on screen with a
 * retry, since the app already exists and its secret is shown only once.
 */
const FeishuQuickCreate = memo<FeishuQuickCreateProps>(
  ({ appPreset, onCreated, platform, scope }) => {
    const { t } = useTranslation('agent');
    const [attempt, setAttempt] = useState(0);
    const [brand, setBrand] = useState<Brand>('feishu');
    const [slowDowns, setSlowDowns] = useState(0);
    const reportedRef = useRef<string>(undefined);
    const pollFailuresRef = useRef(0);
    const {
      clear,
      save: persist,
      saving,
      unsaved,
    } = useCreatedAppSave({
      fallbackMessage: t('channel.quickSetup.feishu.scan.saveFailed'),
      onCreated,
      platform,
    });

    const {
      data: session,
      error: beginError,
      isLoading: beginning,
    } = useClientDataSWR(
      ['agentChannel/feishuRegister', platform, scope, attempt],
      () => agentBotProviderService.feishuRegisterBegin({ platform, ...appPreset }),
      {
        revalidateIfStale: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        shouldRetryOnError: false,
      },
    );

    const { data: poll, error: pollError } = useClientDataSWR(
      session ? ['agentChannel/feishuRegisterPoll', session.deviceCode, brand] : null,
      () =>
        tolerateTransientPollFailure(
          () =>
            agentBotProviderService.feishuRegisterPoll({
              brand,
              deviceCode: session!.deviceCode,
              platform,
            }),
          pollFailuresRef,
          { brand, status: 'pending' as const },
        ),
      {
        onSuccess: (result) => {
          if (result.status === 'pending' && result.brand !== brand) setBrand(result.brand);
          if (result.status === 'pending' && 'slowDown' in result && result.slowDown)
            setSlowDowns((count) => count + 1);
          if (result.status === 'success' && reportedRef.current !== session?.deviceCode) {
            reportedRef.current = session?.deviceCode;
            void persist({ appId: result.appId, appSecret: result.appSecret, brand: result.brand });
          }
        },
        refreshInterval: (result) =>
          !result || result.status === 'pending'
            ? registrationPollInterval(session?.interval, slowDowns)
            : 0,
        revalidateOnFocus: false,
        shouldRetryOnError: false,
      },
    );

    const regenerate = () => {
      clear();
      setBrand('feishu');
      setSlowDowns(0);
      pollFailuresRef.current = 0;
      setAttempt((value) => value + 1);
    };

    const failure =
      beginError || pollError
        ? t('channel.quickSetup.feishu.scan.error')
        : poll?.status === 'expired'
          ? t('channel.quickSetup.feishu.scan.expired')
          : poll?.status === 'denied'
            ? t(scanCopyKey(platform, 'denied'))
            : poll?.status === 'error'
              ? t('channel.quickSetup.feishu.scan.error')
              : undefined;
    const created = poll?.status === 'success';

    return (
      <Flexbox
        horizontal
        align={'center'}
        data-testid={'feishu-quick-create'}
        gap={20}
        wrap={'wrap'}
      >
        <div {...stylex.props(styles.qrSlot)}>
          {beginning || !session ? (
            failure ? null : (
              <Spin />
            )
          ) : created ? (
            <Icon icon={CheckIcon} size={40} style={{ color: cssVar.colorSuccess }} />
          ) : (
            <QRCode
              bgColor={'#fff'}
              bordered={false}
              color={'#000'}
              size={QR_SIZE}
              value={session.url}
            />
          )}
        </div>

        <Flexbox flex={1} gap={10} style={{ minWidth: 200 }}>
          <Text weight={600}>{t(scanCopyKey(platform, 'title'))}</Text>
          <Flexbox gap={6}>
            {(['app', 'permissions', 'credentials'] as const).map((item) => (
              <Flexbox horizontal align={'flex-start'} gap={6} key={item}>
                <Icon
                  icon={CheckIcon}
                  size={14}
                  style={{ color: cssVar.colorSuccess, marginTop: 3 }}
                />
                <Text fontSize={13}>{t(`channel.quickSetup.feishu.scan.does.${item}`)}</Text>
              </Flexbox>
            ))}
          </Flexbox>

          {failure ? (
            <Flexbox gap={8}>
              <Text fontSize={13} type={'danger'}>
                {failure}
              </Text>
              <Button
                icon={<Icon icon={RefreshCwIcon} />}
                style={{ alignSelf: 'flex-start' }}
                onClick={regenerate}
              >
                {t('channel.quickSetup.feishu.scan.regenerate')}
              </Button>
            </Flexbox>
          ) : unsaved ? (
            <Flexbox data-testid={'feishu-quick-create-unsaved'} gap={8}>
              <Text fontSize={13} type={'danger'}>
                {unsaved.message}
              </Text>
              {(
                [
                  ['App ID', unsaved.app.appId],
                  ['App Secret', unsaved.app.appSecret],
                ] as const
              ).map(([label, value]) => (
                <Flexbox horizontal align={'center'} gap={6} key={label}>
                  <Text fontSize={12} type={'secondary'}>
                    {label}
                  </Text>
                  <Text code fontSize={12}>
                    {value}
                  </Text>
                  <CopyButton content={value} size={'small'} />
                </Flexbox>
              ))}
              {unsaved.canRetry && (
                <Button
                  loading={saving}
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => void persist(unsaved.app)}
                >
                  {t('channel.quickSetup.feishu.scan.saveAgain')}
                </Button>
              )}
            </Flexbox>
          ) : created ? (
            <Text fontSize={13} type={'success'}>
              {t('channel.quickSetup.feishu.scan.created')}
            </Text>
          ) : (
            session && (
              <Flexbox gap={6}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <Spin size={'small'} />
                  <Text fontSize={13} type={'secondary'}>
                    {t(scanCopyKey(platform, 'waiting'))}
                  </Text>
                </Flexbox>
                <a href={session.url} rel={'noreferrer'} target={'_blank'}>
                  <Flexbox horizontal align={'center'} gap={4}>
                    <Text fontSize={13}>{t('channel.quickSetup.feishu.scan.openInBrowser')}</Text>
                    <Icon icon={ExternalLinkIcon} size={12} />
                  </Flexbox>
                </a>
              </Flexbox>
            )
          )}
        </Flexbox>
      </Flexbox>
    );
  },
);

FeishuQuickCreate.displayName = 'FeishuQuickCreate';

export default FeishuQuickCreate;

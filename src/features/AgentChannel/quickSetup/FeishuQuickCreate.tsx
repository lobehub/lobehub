'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button, QRCode, Spin, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { agentBotProviderService } from '@/services/agentBotProvider';

const QR_SIZE = 148;

const styles = createStaticStyles(({ css }) => ({
  qrSlot: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: ${QR_SIZE + 16}px;
    height: ${QR_SIZE + 16}px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: #fff;
  `,
}));

export interface FeishuCreatedApp {
  appId: string;
  appSecret: string;
  /** The tenant that scanned: a Lark account creates a Lark app. */
  brand: 'feishu' | 'lark';
}

interface FeishuQuickCreateProps {
  appPreset?: { avatar?: string; desc?: string; name?: string };
  onCreated: (app: FeishuCreatedApp) => void;
  platform: 'feishu' | 'lark';
}

type Brand = FeishuCreatedApp['brand'];

/**
 * Feishu / Lark scan-to-create: one scan creates the bot app with messaging
 * scopes and the receive-message event already set, and hands back its
 * credentials. Polls while waiting; an expired or declined code regenerates.
 */
const FeishuQuickCreate = memo<FeishuQuickCreateProps>(({ appPreset, onCreated, platform }) => {
  const { t } = useTranslation('agent');
  const [attempt, setAttempt] = useState(0);
  const [brand, setBrand] = useState<Brand>('feishu');
  const reportedRef = useRef<string>(undefined);

  const {
    data: session,
    error: beginError,
    isLoading: beginning,
  } = useClientDataSWR(
    ['agentChannel/feishuRegister', platform, attempt],
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
      agentBotProviderService.feishuRegisterPoll({
        brand,
        deviceCode: session!.deviceCode,
        platform,
      }),
    {
      onSuccess: (result) => {
        if (result.status === 'pending' && result.brand !== brand) setBrand(result.brand);
        if (result.status === 'success' && reportedRef.current !== session?.deviceCode) {
          reportedRef.current = session?.deviceCode;
          onCreated({ appId: result.appId, appSecret: result.appSecret, brand: result.brand });
        }
      },
      refreshInterval: (result) =>
        !result || result.status === 'pending'
          ? ((session?.interval ?? 5) + (result?.status === 'pending' && result.slowDown ? 5 : 0)) *
            1000
          : 0,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  const regenerate = () => {
    setBrand('feishu');
    setAttempt((value) => value + 1);
  };

  const failure =
    beginError || pollError
      ? t('channel.quickSetup.feishu.scan.error')
      : poll?.status === 'expired'
        ? t('channel.quickSetup.feishu.scan.expired')
        : poll?.status === 'denied'
          ? t('channel.quickSetup.feishu.scan.denied')
          : poll?.status === 'error'
            ? t('channel.quickSetup.feishu.scan.error')
            : undefined;
  const created = poll?.status === 'success';

  return (
    <Flexbox horizontal align={'center'} data-testid={'feishu-quick-create'} gap={20} wrap={'wrap'}>
      <div className={styles.qrSlot}>
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
        <Text weight={600}>{t('channel.quickSetup.feishu.scan.title')}</Text>
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
              size={'small'}
              style={{ alignSelf: 'flex-start' }}
              onClick={regenerate}
            >
              {t('channel.quickSetup.feishu.scan.regenerate')}
            </Button>
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
                  {t('channel.quickSetup.feishu.scan.waiting')}
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
});

FeishuQuickCreate.displayName = 'FeishuQuickCreate';

export default FeishuQuickCreate;

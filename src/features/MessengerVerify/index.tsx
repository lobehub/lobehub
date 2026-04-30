'use client';

import { Avatar, Button, Flexbox, Icon, Select, Text } from '@lobehub/ui';
import { Slack, Telegram } from '@lobehub/ui/icons';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2Icon, LinkIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { memo, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ProductLogo } from '@/components/Branding';
import Loading from '@/components/Loading/BrandTextLoading';
import { DEFAULT_AVATAR } from '@/const/meta';
import { useSession } from '@/libs/better-auth/auth-client';
import { messengerService } from '@/services/messenger';

const PLATFORM_LABELS: Record<string, string> = {
  slack: 'Slack',
  telegram: 'Telegram',
};

const PLATFORM_BRAND_ICONS: Record<string, ReactNode> = {
  slack: <Slack.Color size={32} />,
  telegram: <Telegram.Color size={36} />,
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  bubble: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 64px;
    height: 64px;
    border-radius: 14px;

    background: ${cssVar.colorBgContainer};
    box-shadow:
      0 1px 2px rgb(0 0 0 / 6%),
      0 4px 12px rgb(0 0 0 / 4%);
  `,
  card: css`
    width: 100%;
    max-width: 440px;
  `,
  chainBubble: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 999px;

    color: ${cssVar.colorBgContainer};

    background: ${cssVar.colorTextBase};
  `,
  iconRow: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;

    margin-block-end: 8px;
  `,
}));

const ChainBubble = ({ className }: { className: string }) => (
  <div className={className}>
    <Icon icon={LinkIcon} size={16} />
  </div>
);

const PlatformBubble = ({ className, platform }: { className: string; platform: string }) => {
  const icon = PLATFORM_BRAND_ICONS[platform];
  return <div className={className}>{icon ?? <Icon icon={LinkIcon} size={32} />}</div>;
};

const Heading = ({ subtitle, title }: { subtitle?: string; title: string }) => (
  <Flexbox align="center" gap={12}>
    <Text
      align="center"
      as="h1"
      style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.3, margin: 0 }}
    >
      {title}
    </Text>
    {subtitle && (
      <Text align="center" style={{ fontSize: 16, lineHeight: 1.5 }} type="secondary">
        {subtitle}
      </Text>
    )}
  </Flexbox>
);

const MessengerVerifyPage = memo(() => {
  const { t } = useTranslation('messenger');
  const { t: tCommon } = useTranslation('common');
  const searchParams = useSearchParams();
  const { message } = App.useApp();

  const randomId = searchParams.get('random_id') ?? '';
  const { data: session, isPending: sessionPending } = useSession();
  const isSignedIn = !!session?.user;

  const agentsSWR = useSWR(isSignedIn ? ['messenger:agents'] : null, async () =>
    messengerService.listAgentsForBinding(),
  );

  const defaultAgentTitle = tCommon('defaultSession');
  const agentOptions = useMemo(
    () =>
      (agentsSWR.data ?? []).map((agent) => {
        const title = agent.title || defaultAgentTitle;
        return {
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <Avatar
                avatar={agent.avatar || DEFAULT_AVATAR}
                background={agent.backgroundColor ?? undefined}
                size={20}
              />
              <Text ellipsis>{title}</Text>
            </Flexbox>
          ),
          searchValue: title,
          title,
          value: agent.id,
        };
      }),
    [agentsSWR.data, defaultAgentTitle],
  );

  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const tokenSWR = useSWR(randomId && isSignedIn ? ['messenger:peek', randomId] : null, async () =>
    messengerService.peekLinkToken(randomId),
  );

  // Default-select the first agent once loaded; user can change before confirming.
  useEffect(() => {
    if (selectedAgentId || agentOptions.length === 0) return;
    setSelectedAgentId(agentOptions[0].value);
  }, [agentOptions, selectedAgentId]);

  const handleConfirm = async () => {
    if (!randomId || !selectedAgentId) return;
    setConfirming(true);
    try {
      await messengerService.confirmLink({
        initialAgentId: selectedAgentId,
        randomId,
      });
      setDone(true);
    } catch (error: any) {
      message.error(error?.message ?? t('verify.error.generic'));
    } finally {
      setConfirming(false);
    }
  };

  if (!randomId) {
    return (
      <Flexbox align="center" className={styles.card} gap={24}>
        <Heading subtitle={t('verify.error.missingToken')} title={t('verify.error.title')} />
      </Flexbox>
    );
  }

  if (sessionPending) {
    return <Loading debugId="MessengerVerify" />;
  }

  if (!isSignedIn) {
    const signInUrl = `/signin?callbackUrl=${encodeURIComponent(
      `/verify-im?${searchParams.toString()}`,
    )}`;
    return (
      <Flexbox align="center" className={styles.card} gap={24}>
        <Heading subtitle={t('verify.signInRequired')} title={t('verify.confirm.title')} />
        <Button block href={signInUrl} size="large" type="primary">
          {t('verify.signInCta')}
        </Button>
      </Flexbox>
    );
  }

  if (tokenSWR.isLoading) {
    return <Loading debugId="MessengerVerify" />;
  }

  if (tokenSWR.error || !tokenSWR.data) {
    return (
      <Flexbox align="center" className={styles.card} gap={24}>
        <Heading
          subtitle={tokenSWR.error?.message ?? t('verify.error.expired')}
          title={t('verify.error.title')}
        />
      </Flexbox>
    );
  }

  const platformLabel = PLATFORM_LABELS[tokenSWR.data.platform] ?? tokenSWR.data.platform;
  const handle = tokenSWR.data.platformUsername ?? `ID ${tokenSWR.data.platformUserId}`;

  if (done) {
    return (
      <Flexbox align="center" className={styles.card} gap={24}>
        <div className={styles.iconRow}>
          <div className={styles.bubble} style={{ background: '#22c55e', color: '#ffffff' }}>
            <Icon icon={CheckCircle2Icon} size={32} />
          </div>
        </div>
        <Heading
          subtitle={t('verify.success.description', { platform: platformLabel })}
          title={t('verify.success.title')}
        />
      </Flexbox>
    );
  }

  return (
    <Flexbox align="center" className={styles.card} gap={32}>
      {/* Two-bubble icon row: LobeHub ↔ platform */}
      <div className={styles.iconRow}>
        <div className={styles.bubble}>
          <ProductLogo size={36} type="3d" />
        </div>
        <ChainBubble className={styles.chainBubble} />
        <PlatformBubble className={styles.bubble} platform={tokenSWR.data.platform} />
      </div>

      <Heading
        subtitle={t('verify.confirm.description', { handle, platform: platformLabel })}
        title={t('verify.confirm.title')}
      />

      <Flexbox gap={8} style={{ width: '100%' }}>
        <Text strong>{t('verify.confirm.defaultAgent')}</Text>
        {agentOptions.length === 0 ? (
          <Text type="warning">{t('verify.confirm.noAgents')}</Text>
        ) : (
          <Select
            options={agentOptions}
            placeholder={t('verify.confirm.defaultAgentPlaceholder')}
            value={selectedAgentId}
            onChange={setSelectedAgentId}
          />
        )}
        <Text style={{ fontSize: 12 }} type="secondary">
          {t('verify.confirm.defaultAgentHint')}
        </Text>
      </Flexbox>

      <Button
        block
        disabled={!selectedAgentId}
        loading={confirming}
        size="large"
        type="primary"
        onClick={handleConfirm}
      >
        {t('verify.confirm.cta')}
      </Button>
    </Flexbox>
  );
});

MessengerVerifyPage.displayName = 'MessengerVerifyPage';

export default MessengerVerifyPage;

'use client';

import { Button, Flexbox, Icon, Select, Text } from '@lobehub/ui';
import { App } from 'antd';
import { CheckCircle2Icon, LinkIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import Loading from '@/components/Loading/BrandTextLoading';
import AuthCard from '@/features/AuthCard';
import { useSession } from '@/libs/better-auth/auth-client';
import { messengerService } from '@/services/messenger';

const PLATFORM_LABELS: Record<string, string> = {
  slack: 'Slack',
  telegram: 'Telegram',
};

const IconBubble = ({ icon }: { icon: typeof LinkIcon }) => (
  <Flexbox align="center" justify="center" paddingBlock={16}>
    <Flexbox
      align="center"
      justify="center"
      style={{
        background: 'var(--ant-color-fill-secondary)',
        borderRadius: 12,
        height: 56,
        width: 56,
      }}
    >
      <Icon icon={icon} size={28} />
    </Flexbox>
  </Flexbox>
);

const MessengerVerifyPage = memo(() => {
  const { t } = useTranslation('messenger');
  const searchParams = useSearchParams();
  const { message } = App.useApp();

  const randomId = searchParams.get('random_id') ?? '';
  const { data: session, isPending: sessionPending } = useSession();
  const isSignedIn = !!session?.user;

  const agentsSWR = useSWR(isSignedIn ? ['messenger:agents'] : null, async () =>
    messengerService.listAgentsForBinding(),
  );

  const agentOptions = useMemo(
    () =>
      (agentsSWR.data ?? []).map((agent) => ({
        label: agent.title,
        value: agent.id,
      })),
    [agentsSWR.data],
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
    return <AuthCard subtitle={t('verify.error.missingToken')} title={t('verify.error.title')} />;
  }

  if (sessionPending) {
    return <Loading debugId="MessengerVerify" />;
  }

  if (!isSignedIn) {
    const signInUrl = `/signin?callbackUrl=${encodeURIComponent(
      `/verify-im?${searchParams.toString()}`,
    )}`;
    return (
      <AuthCard
        subtitle={t('verify.signInRequired')}
        title={t('verify.confirm.title')}
        footer={
          <Button block href={signInUrl} size="large" type="primary">
            {t('verify.signInCta')}
          </Button>
        }
      />
    );
  }

  if (tokenSWR.isLoading) {
    return <Loading debugId="MessengerVerify" />;
  }

  if (tokenSWR.error || !tokenSWR.data) {
    return (
      <AuthCard
        subtitle={tokenSWR.error?.message ?? t('verify.error.expired')}
        title={t('verify.error.title')}
      />
    );
  }

  const platformLabel = PLATFORM_LABELS[tokenSWR.data.platform] ?? tokenSWR.data.platform;
  const handle = tokenSWR.data.platformUsername ?? `ID ${tokenSWR.data.platformUserId}`;

  if (done) {
    return (
      <AuthCard
        subtitle={t('verify.success.description', { platform: platformLabel })}
        title={t('verify.success.title')}
      >
        <IconBubble icon={CheckCircle2Icon} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      subtitle={t('verify.confirm.description', { handle, platform: platformLabel })}
      title={t('verify.confirm.title')}
      footer={
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
      }
    >
      <IconBubble icon={LinkIcon} />
      <Flexbox gap={8}>
        <Text strong>{t('verify.confirm.defaultAgent')}</Text>
        {agentOptions.length === 0 ? (
          <Text type="warning">{t('verify.confirm.noAgents')}</Text>
        ) : (
          <Select
            showSearch
            optionFilterProp="label"
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
    </AuthCard>
  );
});

MessengerVerifyPage.displayName = 'MessengerVerifyPage';

export default MessengerVerifyPage;

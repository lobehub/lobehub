'use client';

import { Block, Button, Flexbox, Icon, Select, Text } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2Icon, LinkIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import Loading from '@/components/Loading/BrandTextLoading';
import { messengerService } from '@/services/messenger';
import { useSessionStore } from '@/store/session';
import { sessionMetaSelectors, sessionSelectors } from '@/store/session/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    width: 100%;
    max-width: 480px;
    padding: 32px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  iconBubble: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 56px;
    height: 56px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillSecondary};
  `,
  iconRow: css`
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;

    padding-block: 16px;
  `,
  root: css`
    display: flex;
    align-items: center;
    justify-content: center;

    min-height: 100vh;
    padding: 24px;

    background: ${cssVar.colorBgLayout};
  `,
}));

const PLATFORM_LABELS: Record<string, string> = {
  slack: 'Slack',
  telegram: 'Telegram',
};

const MessengerVerifyPage = memo(() => {
  const { t } = useTranslation('messenger');
  const [searchParams] = useSearchParams();
  const { message } = App.useApp();

  const randomId = searchParams.get('random_id') ?? '';
  const isSignedIn = useUserStore(authSelectors.isLogin);

  const useFetchSessions = useSessionStore((s) => s.useFetchSessions);
  useFetchSessions(isSignedIn === true, isSignedIn);

  // Filter to agent-type sessions only — messenger binds to an agent, not a group
  const sessions = useSessionStore((s) =>
    sessionSelectors.defaultSessions(s).filter((session) => session.type === 'agent'),
  );

  const agentOptions = useMemo(
    () =>
      sessions.map((session) => ({
        label: sessionMetaSelectors.getTitle(session.meta) ?? session.id.slice(0, 8),
        value: session.id,
      })),
    [sessions],
  );

  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const tokenSWR = useSWR(randomId && isSignedIn ? ['messenger:peek', randomId] : null, async () =>
    messengerService.peekLinkToken(randomId),
  );

  // Default-select the first agent once loaded (most-recently accessed shows
  // first in defaultSessions); user can change it before confirming.
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
      <Flexbox className={styles.root}>
        <Block className={styles.card}>
          <Text type="secondary">{t('verify.error.missingToken')}</Text>
        </Block>
      </Flexbox>
    );
  }

  if (!isSignedIn) {
    const signInUrl = `/signin?callbackUrl=${encodeURIComponent(
      `/verify-im?${searchParams.toString()}`,
    )}`;
    return (
      <Flexbox className={styles.root}>
        <Block className={styles.card}>
          <Flexbox align="center" gap={16}>
            <Text>{t('verify.signInRequired')}</Text>
            <Button block href={signInUrl} type="primary">
              {t('verify.signInCta')}
            </Button>
          </Flexbox>
        </Block>
      </Flexbox>
    );
  }

  if (tokenSWR.isLoading) {
    return <Loading debugId="MessengerVerify" />;
  }

  if (tokenSWR.error || !tokenSWR.data) {
    return (
      <Flexbox className={styles.root}>
        <Block className={styles.card}>
          <Text type="danger">{tokenSWR.error?.message ?? t('verify.error.expired')}</Text>
        </Block>
      </Flexbox>
    );
  }

  const platformLabel = PLATFORM_LABELS[tokenSWR.data.platform] ?? tokenSWR.data.platform;
  const handle = tokenSWR.data.platformUsername ?? `ID ${tokenSWR.data.platformUserId}`;

  if (done) {
    return (
      <Flexbox className={styles.root}>
        <Block className={styles.card}>
          <Flexbox align="center" gap={16}>
            <div className={styles.iconRow}>
              <div className={styles.iconBubble}>
                <Icon icon={CheckCircle2Icon} size={32} />
              </div>
            </div>
            <Text strong style={{ fontSize: 20, textAlign: 'center' }}>
              {t('verify.success.title')}
            </Text>
            <Text style={{ textAlign: 'center' }} type="secondary">
              {t('verify.success.description', { platform: platformLabel })}
            </Text>
          </Flexbox>
        </Block>
      </Flexbox>
    );
  }

  return (
    <Flexbox className={styles.root}>
      <Block className={styles.card}>
        <Flexbox gap={20}>
          <div className={styles.iconRow}>
            <div className={styles.iconBubble}>
              <Icon icon={LinkIcon} size={28} />
            </div>
          </div>
          <Text strong style={{ fontSize: 20, textAlign: 'center' }}>
            {t('verify.confirm.title')}
          </Text>
          <Text style={{ textAlign: 'center' }} type="secondary">
            {t('verify.confirm.description', { handle, platform: platformLabel })}
          </Text>

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

          <Button
            block
            disabled={!selectedAgentId}
            loading={confirming}
            type="primary"
            onClick={handleConfirm}
          >
            {t('verify.confirm.cta')}
          </Button>
        </Flexbox>
      </Block>
    </Flexbox>
  );
});

MessengerVerifyPage.displayName = 'MessengerVerifyPage';

export default MessengerVerifyPage;

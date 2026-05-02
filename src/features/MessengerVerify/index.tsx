'use client';

import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { Slack, Telegram } from '@lobehub/ui/icons';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2Icon, LinkIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { memo, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ProductLogo } from '@/components/Branding';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentSelect from '@/features/Messenger/AgentSelect';
import { useSession } from '@/libs/better-auth/auth-client';
import { lambdaClient } from '@/libs/trpc/client';
import { messengerService } from '@/services/messenger';

const PLATFORM_LABELS: Record<string, string> = {
  slack: 'Slack',
  telegram: 'Telegram',
};

const PLATFORM_BRAND_ICONS: Record<string, ReactNode> = {
  slack: <Slack.Color size={32} />,
  telegram: <Telegram.Color size={36} />,
};

/**
 * Build the deep-link back to the platform's bot so the success state can
 * bounce the user straight into the chat. Returns null when the platform has
 * no useful deep-link mechanism (Slack workspaces vary per-tenant; not worth
 * guessing) or when the bot username isn't configured.
 *
 * Note: we deliberately skip Telegram's `?start=` query param here. Including
 * it would trigger the bot's auto-`/start` flow, but the user just finished
 * binding and only wants to open the chat — re-triggering /start would
 * confuse the bot into re-issuing a link button.
 */
const buildOpenBotUrl = (platform: string, botUsername: string | undefined): string | null => {
  if (platform === 'telegram' && botUsername) {
    return `https://t.me/${botUsername.replace(/^@/, '')}`;
  }
  return null;
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
  const searchParams = useSearchParams();
  const { message } = App.useApp();

  const randomId = searchParams.get('random_id') ?? '';
  const imType = searchParams.get('im_type') ?? '';
  const { data: session, isPending: sessionPending } = useSession();
  const isSignedIn = !!session?.user;

  // Refresh-friendly: if the user already has a link for this platform, skip
  // the token flow entirely and jump to the success state. Without this,
  // refreshing the page after a successful link looks like an expired-token
  // error (the random_id token gets consumed on confirm).
  const existingLinkSWR = useSWR(
    isSignedIn && (imType === 'telegram' || imType === 'slack')
      ? ['messenger:myLink', imType]
      : null,
    async () => messengerService.getMyLink(imType as 'telegram' | 'slack'),
  );
  const alreadyLinked = !!existingLinkSWR.data;

  // Messenger is a Labs-gated feature: don't let a user bind a new account
  // unless they've explicitly opted in. (Existing bindings keep working — the
  // bot's webhook doesn't consult this flag — but forming new ones requires
  // a deliberate Labs toggle.)
  const userStateSWR = useSWR(isSignedIn ? ['user:state'] : null, () =>
    lambdaClient.user.getUserState.query(),
  );
  const labMessengerEnabled = !!userStateSWR.data?.preference?.lab?.enableMessenger;

  // Pre-populate the default selected agent from the same SWR cache the shared
  // AgentSelect uses (so the very first row is selected once the list lands).
  const agentsSWR = useSWR(isSignedIn ? 'messenger:agentsForBinding' : null, () =>
    messengerService.listAgentsForBinding(),
  );

  // Used in the success state to deep-link the user back to the bot.
  const platformsSWR = useSWR('messenger:availablePlatforms', () =>
    messengerService.availablePlatforms(),
  );

  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const tokenSWR = useSWR(randomId && isSignedIn ? ['messenger:peek', randomId] : null, async () =>
    messengerService.peekLinkToken(randomId),
  );

  // Default-select the first agent once loaded; user can change before confirming.
  useEffect(() => {
    if (selectedAgentId || !agentsSWR.data?.length) return;
    setSelectedAgentId(agentsSWR.data[0].id);
  }, [agentsSWR.data, selectedAgentId]);

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

  if (sessionPending || existingLinkSWR.isLoading || userStateSWR.isLoading) {
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

  // Lab gate: Messenger is opt-in. If the user already linked, we let them
  // through to the success state below — disabling the lab shouldn't strand
  // someone mid-flow on a binding they already started.
  if (!labMessengerEnabled && !existingLinkSWR.data) {
    return (
      <Flexbox align="center" className={styles.card} gap={24}>
        <Heading
          subtitle={t('verify.labRequired.description')}
          title={t('verify.labRequired.title')}
        />
        <Button block href="/settings/advanced" size="large" type="primary">
          {t('verify.labRequired.openSettings')}
        </Button>
      </Flexbox>
    );
  }

  // Already linked (from a prior successful confirm — survives page refresh)
  // OR just-confirmed in this session: jump straight to the success state.
  if (alreadyLinked || done) {
    const platform = (existingLinkSWR.data?.platform ?? tokenSWR.data?.platform ?? imType) as
      | string
      | undefined;
    const platformLabelSuccess = platform ? (PLATFORM_LABELS[platform] ?? platform) : '';
    const botUsername = platformsSWR.data?.find((p) => p.platform === platform)?.botUsername;
    const openBotUrl = platform ? buildOpenBotUrl(platform, botUsername) : null;
    return (
      <Flexbox align="center" className={styles.card} gap={24}>
        <div className={styles.iconRow}>
          <div className={styles.bubble} style={{ background: '#22c55e', color: '#ffffff' }}>
            <Icon icon={CheckCircle2Icon} size={32} />
          </div>
        </div>
        <Heading
          subtitle={t('verify.success.description', { platform: platformLabelSuccess })}
          title={t('verify.success.title')}
        />
        {openBotUrl && (
          <Button block href={openBotUrl} size="large" target="_blank" type="primary">
            {t('verify.success.openBot', { platform: platformLabelSuccess })}
          </Button>
        )}
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

  // Slack-specific copy: Manus-style "Slack is requesting access to LobeHub"
  // with workspace name + email surfaced. URL params (`slack_user_email`,
  // `slack_team_id`) are echoed in the link the bot sent so the page can
  // render rich identity context without an extra round-trip.
  const isSlack = tokenSWR.data.platform === 'slack';
  const slackEmail = isSlack ? (searchParams.get('slack_user_email') ?? '') : '';
  const slackUserId = isSlack ? (searchParams.get('slack_user_id') ?? '') : '';
  const tenantName = isSlack ? (tokenSWR.data.tenantName ?? '') : '';

  const headingTitle = isSlack ? t('verify.slack.title') : t('verify.confirm.title');
  const headingSubtitle = isSlack
    ? t('verify.slack.description')
    : t('verify.confirm.description', { handle, platform: platformLabel });

  // Identity line shown above the agent picker for Slack — fall back through
  // email-with-workspace → email-only → user-id-with-workspace as fields drop.
  const slackIdentityLine = (() => {
    if (!isSlack) return null;
    if (slackEmail && tenantName)
      return t('verify.slack.identityLine', { email: slackEmail, workspace: tenantName });
    if (slackEmail) return t('verify.slack.identityLineNoWorkspace', { email: slackEmail });
    if (tenantName)
      return t('verify.slack.identityLineNoEmail', { userId: slackUserId, workspace: tenantName });
    return null;
  })();

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

      <Heading subtitle={headingSubtitle} title={headingTitle} />

      {slackIdentityLine && (
        <Text strong align="center" style={{ fontSize: 15 }}>
          {slackIdentityLine}
        </Text>
      )}

      <Flexbox gap={8} style={{ width: '100%' }}>
        <Text strong>{t('verify.confirm.defaultAgent')}</Text>
        {agentsSWR.data?.length === 0 ? (
          <Text type="warning">{t('verify.confirm.noAgents')}</Text>
        ) : (
          <AgentSelect
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

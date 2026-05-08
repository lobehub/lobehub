'use client';

import { Block, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { Discord, Slack, Telegram } from '@lobehub/ui/icons';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { AlertTriangleIcon, CheckCircle2Icon, LinkIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { memo, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { ProductLogo } from '@/components/Branding';
import Loading from '@/components/Loading/BrandTextLoading';
import AgentSelect from '@/features/Messenger/AgentSelect';
import { getMessengerErrorMessage } from '@/features/Messenger/i18n';
import { useSession } from '@/libs/better-auth/auth-client';
import { lambdaClient } from '@/libs/trpc/client';
import { messengerService } from '@/services/messenger';

const PLATFORM_BRAND_ICONS: Record<string, ReactNode> = {
  discord: <Discord.Color size={32} />,
  slack: <Slack.Color size={32} />,
  telegram: <Telegram.Color size={36} />,
};

/**
 * Build the deep-link back to the platform's bot so the success state can
 * bounce the user straight into the chat.
 *
 * - Telegram: `https://t.me/<bot>` (skips `?start=` so we don't re-trigger
 *   the bot's auto-/start flow right after binding).
 * - Slack: prefer `https://slack.com/app_redirect?app=<APP_ID>&team=<TEAM_ID>`
 *   when both are known — Slack handles desktop hand-off and lands the user
 *   in the bot DM. Falls back to the workspace URL when only the team id is
 *   known.
 */
interface OpenBotOptions {
  appId?: string;
  botUsername?: string;
  tenantId?: string;
}

const buildOpenBotUrl = (platform: string, opts: OpenBotOptions): string | null => {
  if (platform === 'telegram' && opts.botUsername) {
    return `https://t.me/${opts.botUsername.replace(/^@/, '')}`;
  }
  if (platform === 'slack' && opts.tenantId) {
    if (opts.appId) {
      return `https://slack.com/app_redirect?app=${opts.appId}&team=${opts.tenantId}`;
    }
    return `https://app.slack.com/client/${opts.tenantId}`;
  }
  // Discord App IDs are the bot user id for bot accounts, so the canonical
  // user-profile URL opens the bot's profile page where the user can hit
  // "Send Message" to start a DM.
  if (platform === 'discord' && opts.appId) {
    return `https://discord.com/users/${opts.appId}`;
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
  infoRow: css`
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;

    padding-block: 10px;

    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  infoValue: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  warningBlock: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-color: ${cssVar.colorWarningBorder};
    background: ${cssVar.colorWarningBg};
  `,
  warningIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorWarning};
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

  // Refresh-friendly: if the user already has a link for *this* (platform,
  // tenant) pair, skip the token flow entirely and jump to the success state.
  // Without this, refreshing the page after a successful link looks like an
  // expired-token error (the random_id token gets consumed on confirm).
  //
  // Scoping by tenant is critical for Slack multi-workspace: a user already
  // linked to workspace A must not short-circuit when verifying workspace B,
  // otherwise confirmLink for B never runs. We wait for the token payload to
  // resolve so we know the tenant. If the token is gone (expired/consumed,
  // typical of a post-confirm refresh), fall back to the unscoped lookup so
  // the refresh still lands on success.
  const tokenResolved = !tokenSWR.isLoading;
  const tokenTenantId = tokenSWR.data?.tenantId;
  const tokenScopeKey = tokenSWR.data ? (tokenTenantId ?? '') : '__any__';
  const existingLinkSWR = useSWR(
    isSignedIn &&
      tokenResolved &&
      (imType === 'telegram' || imType === 'slack' || imType === 'discord')
      ? ['messenger:myLink', imType, tokenScopeKey]
      : null,
    async () =>
      messengerService.getMyLink(
        imType as 'telegram' | 'slack' | 'discord',
        tokenSWR.data ? tokenTenantId : undefined,
      ),
  );
  const alreadyLinked = !!existingLinkSWR.data;

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
    } catch (error) {
      message.error(getMessengerErrorMessage(error, t, 'verify.error.generic'));
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

  if (
    sessionPending ||
    userStateSWR.isLoading ||
    // Wait for the token peek so the existing-link lookup below can scope by
    // tenantId (otherwise a Slack workspace-A link short-circuits workspace-B
    // verification). isSignedIn is required for tokenSWR to fire at all.
    (isSignedIn && tokenSWR.isLoading) ||
    existingLinkSWR.isLoading
  ) {
    return <Loading debugId="MessengerVerify" />;
  }

  if (!isSignedIn) {
    const signInUrl = `/signin?callbackUrl=${encodeURIComponent(
      `/verify-im?${searchParams.toString()}`,
    )}`;
    return (
      <Flexbox align="center" className={styles.card} gap={32}>
        {PLATFORM_BRAND_ICONS[imType] && (
          <div className={styles.iconRow}>
            <div className={styles.bubble}>
              <ProductLogo size={36} type="3d" />
            </div>
            <ChainBubble className={styles.chainBubble} />
            <PlatformBubble className={styles.bubble} platform={imType} />
          </div>
        )}
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
    const platformMeta = platformsSWR.data?.find((p) => p.id === platform);
    const platformLabelSuccess = platformMeta?.name ?? platform ?? '';
    const tenantId = existingLinkSWR.data?.tenantId ?? tokenSWR.data?.tenantId ?? undefined;
    const openBotUrl = platform
      ? buildOpenBotUrl(platform, {
          appId: platformMeta?.appId,
          botUsername: platformMeta?.botUsername,
          tenantId,
        })
      : null;
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
          subtitle={getMessengerErrorMessage(tokenSWR.error, t, 'verify.error.expired')}
          title={t('verify.error.title')}
        />
      </Flexbox>
    );
  }

  const platformLabel =
    platformsSWR.data?.find((p) => p.id === tokenSWR.data!.platform)?.name ??
    tokenSWR.data.platform;
  const handle = tokenSWR.data.platformUsername ?? `ID ${tokenSWR.data.platformUserId}`;
  const workspaceName = tokenSWR.data.tenantName;
  const lobeAccount = session?.user?.email ?? session?.user?.name ?? '';
  // `linkedToEmail` is set by the server when the IM identity is already
  // bound to a LobeHub account. If we reach this branch (the alreadyLinked
  // short-circuit above didn't fire), the existing binding belongs to a
  // *different* LobeHub account — block confirm and tell the user to switch.
  const linkedToEmail = tokenSWR.data.linkedToEmail;
  const hasConflict = !!linkedToEmail;
  const signInUrl = `/signin?callbackUrl=${encodeURIComponent(
    `/verify-im?${searchParams.toString()}`,
  )}`;

  const infoRows: { label: string; value: string }[] = [
    { label: t('verify.confirm.fields.lobeHubAccount'), value: lobeAccount },
    {
      label: t('verify.confirm.fields.platformAccount', { platform: platformLabel }),
      value: handle,
    },
  ];
  if (workspaceName) {
    infoRows.push({ label: t('verify.confirm.fields.workspace'), value: workspaceName });
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

      <Heading title={t('verify.confirm.title')} />

      <Block padding={4} style={{ width: '100%' }} variant={'outlined'}>
        <Flexbox paddingInline={16}>
          {infoRows.map((row) => (
            <div className={styles.infoRow} key={row.label}>
              <Text type="secondary">{row.label}</Text>
              <Text strong className={styles.infoValue} title={row.value}>
                {row.value}
              </Text>
            </div>
          ))}
        </Flexbox>
      </Block>

      {hasConflict && (
        <Block className={styles.warningBlock} style={{ width: '100%' }} variant={'outlined'}>
          <Flexbox horizontal gap={12}>
            <Icon className={styles.warningIcon} icon={AlertTriangleIcon} size={20} />
            <Flexbox gap={8} style={{ flex: 1 }}>
              <Text strong>{t('verify.confirm.conflict.title')}</Text>
              <Text style={{ fontSize: 13 }} type="secondary">
                {t('verify.confirm.conflict.description', {
                  email: linkedToEmail,
                  platform: platformLabel,
                })}
              </Text>
              <Button block href={signInUrl} type="default">
                {t('verify.confirm.conflict.switchAccount')}
              </Button>
            </Flexbox>
          </Flexbox>
        </Block>
      )}

      {!hasConflict && (
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
      )}

      <Button
        block
        disabled={hasConflict || !selectedAgentId}
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

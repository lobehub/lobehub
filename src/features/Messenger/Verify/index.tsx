'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { useSearchParams } from 'next/navigation';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import Loading from '@/components/Loading/BrandTextLoading';
import { useSession } from '@/libs/better-auth/auth-client';
import { lambdaClient } from '@/libs/trpc/client';
import { messengerService } from '@/services/messenger';

import { type MessengerPlatform } from '../constants';
import { getMessengerErrorMessage } from '../i18n';
import Body from './Body';
import { Heading, IconRow, styles } from './Body/shared';

const isSupportedPlatform = (value: string): value is MessengerPlatform =>
  value === 'telegram' || value === 'slack' || value === 'discord';

const MessengerVerifyPage = memo(() => {
  const { t } = useTranslation('messenger');
  const searchParams = useSearchParams();

  const randomId = searchParams.get('random_id') ?? '';
  const imType = searchParams.get('im_type') ?? '';
  const platform = isSupportedPlatform(imType) ? imType : null;

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

  // Used in the success state to deep-link the user back to the bot.
  const platformsSWR = useSWR('messenger:availablePlatforms', () =>
    messengerService.availablePlatforms(),
  );

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
    isSignedIn && tokenResolved && platform ? ['messenger:myLink', platform, tokenScopeKey] : null,
    async () => messengerService.getMyLink(platform!, tokenSWR.data ? tokenTenantId : undefined),
  );

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

  const signInUrl = `/signin?callbackUrl=${encodeURIComponent(
    `/verify-im?${searchParams.toString()}`,
  )}`;

  if (!isSignedIn) {
    return (
      <Flexbox align="center" className={styles.card} gap={32}>
        {platform && <IconRow platform={platform} />}
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

  if (!platform) {
    return (
      <Flexbox align="center" className={styles.card} gap={24}>
        <Heading subtitle={t('verify.error.expired')} title={t('verify.error.title')} />
      </Flexbox>
    );
  }

  // Token may be expired/consumed on a post-confirm refresh. We only block on
  // token errors when there's no existing link to fall back on; otherwise the
  // body's success state handles the refresh case below.
  if (!existingLinkSWR.data && (tokenSWR.error || !tokenSWR.data)) {
    return (
      <Flexbox align="center" className={styles.card} gap={24}>
        <Heading
          subtitle={getMessengerErrorMessage(tokenSWR.error, t, 'verify.error.expired')}
          title={t('verify.error.title')}
        />
      </Flexbox>
    );
  }

  const platformMeta = platformsSWR.data?.find(
    (p) => p.id === (existingLinkSWR.data?.platform ?? tokenSWR.data?.platform ?? platform),
  );
  const lobeAccount = session?.user?.email ?? session?.user?.name ?? '';

  return (
    <Body
      existingLink={existingLinkSWR.data ?? null}
      lobeAccount={lobeAccount}
      platform={platform}
      platformMeta={platformMeta}
      randomId={randomId}
      signInUrl={signInUrl}
      tokenData={tokenSWR.data ?? null}
    />
  );
});

MessengerVerifyPage.displayName = 'MessengerVerifyPage';

export default MessengerVerifyPage;

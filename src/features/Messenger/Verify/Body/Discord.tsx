'use client';

import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildDiscordOpenBotUrl } from '../../constants';
import {
  ConfirmCard,
  type ExistingLink,
  type InfoRow,
  type PeekedToken,
  type PlatformMeta,
  SuccessCard,
} from './shared';
import { isSingleAccountRebindBlocked, shouldShowSingleAccountSuccess } from './singleAccountState';

interface DiscordBodyProps {
  existingLink?: ExistingLink | null;
  lobeAccount: string;
  platformMeta?: PlatformMeta;
  randomId: string;
  signInUrl: string;
  tokenData?: PeekedToken | null;
}

const DiscordBody = memo<DiscordBodyProps>(
  ({ existingLink, lobeAccount, platformMeta, randomId, signInUrl, tokenData }) => {
    const { t } = useTranslation('messenger');
    const [done, setDone] = useState(false);

    const platformLabel = platformMeta?.name ?? 'Discord';
    const appId = platformMeta?.appId;
    const rebindBlocked = isSingleAccountRebindBlocked(existingLink, tokenData);

    if (shouldShowSingleAccountSuccess(existingLink, tokenData, done)) {
      return (
        <SuccessCard
          openBotUrl={appId ? buildDiscordOpenBotUrl(appId) : null}
          platformLabel={platformLabel}
        />
      );
    }

    if (!tokenData) return null;

    const handle = tokenData.platformUsername ?? `ID ${tokenData.platformUserId}`;
    const infoRows: InfoRow[] = [
      { label: t('verify.confirm.fields.lobeHubAccount'), value: lobeAccount },
      {
        label: t('verify.confirm.fields.platformAccount', { platform: platformLabel }),
        value: handle,
      },
    ];
    if (tokenData.tenantName) {
      infoRows.push({ label: t('verify.confirm.fields.workspace'), value: tokenData.tenantName });
    }

    return (
      <ConfirmCard
        infoRows={infoRows}
        platform="discord"
        randomId={randomId}
        blockingNotice={
          rebindBlocked
            ? {
                ctaHref: '/settings/messenger/discord',
                ctaLabel: t('verify.confirm.relink.manage'),
                description: t('verify.confirm.relink.description', {
                  account:
                    existingLink?.platformUsername ?? `ID ${existingLink?.platformUserId ?? ''}`,
                  platform: platformLabel,
                }),
                title: t('verify.confirm.relink.title', { platform: platformLabel }),
              }
            : tokenData.linkedToEmail
              ? {
                  ctaHref: signInUrl,
                  ctaLabel: t('verify.confirm.conflict.switchAccount'),
                  description: t('verify.confirm.conflict.description', {
                    email: tokenData.linkedToEmail,
                    platform: platformLabel,
                  }),
                  title: t('verify.confirm.conflict.title'),
                }
              : undefined
        }
        onSuccess={() => setDone(true)}
      />
    );
  },
);
DiscordBody.displayName = 'MessengerVerifyDiscordBody';

export default DiscordBody;

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

    if (existingLink || done) {
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
        conflictEmail={tokenData.linkedToEmail ?? undefined}
        infoRows={infoRows}
        platform="discord"
        platformLabel={platformLabel}
        randomId={randomId}
        signInUrl={signInUrl}
        onSuccess={() => setDone(true)}
      />
    );
  },
);
DiscordBody.displayName = 'MessengerVerifyDiscordBody';

export default DiscordBody;

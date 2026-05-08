'use client';

import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildSlackOpenBotUrl } from '../../constants';
import {
  ConfirmCard,
  type ExistingLink,
  type InfoRow,
  type PeekedToken,
  type PlatformMeta,
  SuccessCard,
} from './shared';

interface SlackBodyProps {
  existingLink?: ExistingLink | null;
  lobeAccount: string;
  platformMeta?: PlatformMeta;
  randomId: string;
  signInUrl: string;
  tokenData?: PeekedToken | null;
}

const SlackBody = memo<SlackBodyProps>(
  ({ existingLink, lobeAccount, platformMeta, randomId, signInUrl, tokenData }) => {
    const { t } = useTranslation('messenger');
    const [done, setDone] = useState(false);

    const platformLabel = platformMeta?.name ?? 'Slack';
    // Slack uses tenant from the existing link (post-confirm/refresh) or the
    // pending token (pre-confirm). Without a tenant, the workspace deep-link
    // can't be built, so the success state hides the CTA.
    const tenantId = existingLink?.tenantId ?? tokenData?.tenantId ?? undefined;

    if (existingLink || done) {
      return (
        <SuccessCard
          openBotUrl={tenantId ? buildSlackOpenBotUrl(tenantId, platformMeta?.appId) : null}
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
        platform="slack"
        platformLabel={platformLabel}
        randomId={randomId}
        signInUrl={signInUrl}
        onSuccess={() => setDone(true)}
      />
    );
  },
);
SlackBody.displayName = 'MessengerVerifySlackBody';

export default SlackBody;

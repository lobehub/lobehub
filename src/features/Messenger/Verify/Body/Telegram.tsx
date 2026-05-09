'use client';

import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buildTelegramBotUrl } from '../../constants';
import {
  ConfirmCard,
  type ExistingLink,
  type InfoRow,
  type PeekedToken,
  type PlatformMeta,
  SuccessCard,
} from './shared';
import { isSingleAccountRebindBlocked, shouldShowSingleAccountSuccess } from './singleAccountState';

interface TelegramBodyProps {
  existingLink?: ExistingLink | null;
  lobeAccount: string;
  platformMeta?: PlatformMeta;
  randomId: string;
  signInUrl: string;
  tokenData?: PeekedToken | null;
}

const TelegramBody = memo<TelegramBodyProps>(
  ({ existingLink, lobeAccount, platformMeta, randomId, signInUrl, tokenData }) => {
    const { t } = useTranslation('messenger');
    const [done, setDone] = useState(false);

    const platformLabel = platformMeta?.name ?? 'Telegram';
    const botUsername = platformMeta?.botUsername;
    const rebindBlocked = isSingleAccountRebindBlocked(existingLink, tokenData);

    if (shouldShowSingleAccountSuccess(existingLink, tokenData, done)) {
      return (
        <SuccessCard
          openBotUrl={botUsername ? buildTelegramBotUrl(botUsername) : null}
          platformLabel={platformLabel}
        />
      );
    }

    if (!tokenData) return null;

    // Telegram has no workspace/tenant concept — skip the workspace row entirely.
    const handle = tokenData.platformUsername ?? `ID ${tokenData.platformUserId}`;
    const infoRows: InfoRow[] = [
      { label: t('verify.confirm.fields.lobeHubAccount'), value: lobeAccount },
      {
        label: t('verify.confirm.fields.platformAccount', { platform: platformLabel }),
        value: handle,
      },
    ];

    return (
      <ConfirmCard
        infoRows={infoRows}
        platform="telegram"
        randomId={randomId}
        blockingNotice={
          rebindBlocked
            ? {
                ctaHref: '/settings/messenger/telegram',
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
TelegramBody.displayName = 'MessengerVerifyTelegramBody';

export default TelegramBody;

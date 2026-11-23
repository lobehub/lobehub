import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { MarketplaceApp } from './catalog';

/** What an app does in one line: its channel or tool blurb, localized when there is one. */
export const useAppSummary = () => {
  const { t } = useTranslation('discover');
  const { t: tm } = useTranslation('messenger');
  return useCallback(
    ({
      channel,
      id,
      officialMcp,
      tool,
    }: Pick<MarketplaceApp, 'channel' | 'id' | 'officialMcp' | 'tool'>) =>
      channel
        ? t(`apps.summary.channel.${channel.id}`, {
            defaultValue: tm(`messenger.list.${channel.id}.description`),
          })
        : t(`apps.summary.tool.${id}`, {
            defaultValue:
              (tool?.type === 'lobehub'
                ? tool.provider.description
                : (tool?.serverType.description ?? officialMcp?.description)) ?? '',
          }),
    [t, tm],
  );
};

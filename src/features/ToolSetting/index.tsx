'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useClientDataSWR } from '@/libs/swr';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { searchService } from '@/services/search';
import { useUserStore } from '@/store/user';

import ChannelSection from './ChannelSection';

const FETCH_AVAILABLE_CHANNELS_KEY = 'FETCH_AVAILABLE_WEB_BROWSING_CHANNELS';

const ToolSetting = memo(() => {
  const { t } = useTranslation('setting');

  const { data, error, isLoading, mutate } = useClientDataSWR(FETCH_AVAILABLE_CHANNELS_KEY, () =>
    searchService.getAvailableChannels(),
  );

  // `ChannelSection` (via `useChannelRows`) seeds its local rows ONCE on mount
  // from the saved channel order. So it must only mount after BOTH the available
  // channels (SWR) AND the user settings store have hydrated — otherwise on a
  // hard refresh it seeds from an unhydrated (undefined) `savedOrder`, silently
  // rendering the default order and ignoring the user's saved priority (and any
  // edit then overwrites the real saved order). Fold the user-state init into the
  // boundary so its skeleton covers both, and mount the sections only once ready.
  const [isUserStateInit, isUserStateInitError, refreshUserState] = useUserStore((s) => [
    s.isUserStateInit,
    s.isUserStateInitError,
    s.refreshUserState,
  ]);

  return (
    <>
      <SettingHeader title={t('tab.tools')} />
      <AsyncBoundary
        data={isUserStateInit ? data : undefined}
        error={error ?? (isUserStateInit ? undefined : isUserStateInitError)}
        isLoading={isLoading || !isUserStateInit}
        onRetry={() => {
          void mutate();
          void refreshUserState();
        }}
      >
        <Flexbox gap={32} style={{ paddingBlock: 16 }}>
          <ChannelSection
            availableIds={(data?.searchProviders ?? []).map((c) => c.id)}
            channelKey={'searchProviders'}
            desc={t('settingTool.search.desc')}
            title={t('settingTool.search.title')}
          />
          <ChannelSection
            availableIds={(data?.crawlerImpls ?? []).map((c) => c.id)}
            channelKey={'crawlerImpls'}
            desc={t('settingTool.crawler.desc')}
            title={t('settingTool.crawler.title')}
          />
        </Flexbox>
      </AsyncBoundary>
    </>
  );
});

export default ToolSetting;

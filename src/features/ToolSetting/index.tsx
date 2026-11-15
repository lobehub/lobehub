'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { ToolsChannelsSkeleton } from '@/components/Skeleton/Settings/tabs/Tools';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import SettingsPageActions from '@/features/Settings/features/SettingsPageActions';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';

import ChannelSection from './ChannelSection';
import { useAvailableChannels } from './useAvailableChannels';

const ToolSetting = memo<{ showSettingHeader?: boolean }>(({ showSettingHeader = true }) => {
  const { t } = useTranslation('setting');
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();

  const { data, error, isLoading, retry: retryChannels } = useAvailableChannels();

  // `ChannelSection` (via `useChannelRows`) seeds its local rows ONCE on mount
  // from the saved channel order. So it must only mount after BOTH the available
  // channels (replica) AND the user settings store have hydrated — otherwise on a
  // hard refresh it seeds from an unhydrated (undefined) `savedOrder`, silently
  // rendering the default order and ignoring the user's saved priority (and any
  // edit then overwrites the real saved order). Fold the user-state init into the
  // boundary so its skeleton covers both, and mount the sections only once ready.
  const [isUserStateInit, isUserStateInitError, refreshUserState] = useUserStore((s) => [
    s.isUserStateInit,
    s.isUserStateInitError,
    s.refreshUserState,
  ]);

  const saveHint = (
    <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />
  );

  return (
    <>
      {showSettingHeader ? (
        <SettingHeader extra={saveHint} title={t('tab.tools')} />
      ) : (
        <SettingsPageActions
          // Mobile has no shared header slot; keep the save status visible above the form.
          fallback={
            <Flexbox horizontal justify={'flex-end'}>
              {saveHint}
            </Flexbox>
          }
        >
          {saveHint}
        </SettingsPageActions>
      )}
      <AsyncBoundary
        data={isUserStateInit ? data : undefined}
        error={error ?? (isUserStateInit ? undefined : isUserStateInitError)}
        isLoading={isLoading || !isUserStateInit}
        loading={<ToolsChannelsSkeleton />}
        onRetry={() => {
          void retryChannels();
          void refreshUserState();
        }}
      >
        <Flexbox gap={32} style={{ paddingBlock: 16 }}>
          <ChannelSection
            availableIds={(data?.searchProviders ?? []).map((c) => c.id)}
            channelKey={'searchProviders'}
            desc={t('settingTool.search.desc')}
            // Rows are seeded once on mount: reseed when a refresh changes the set.
            key={(data?.searchProviders ?? []).map((c) => c.id).join(',')}
            save={save}
            title={t('settingTool.search.title')}
          />
          <ChannelSection
            availableIds={(data?.crawlerImpls ?? []).map((c) => c.id)}
            channelKey={'crawlerImpls'}
            desc={t('settingTool.crawler.desc')}
            // Rows are seeded once on mount: reseed when a refresh changes the set.
            key={(data?.crawlerImpls ?? []).map((c) => c.id).join(',')}
            save={save}
            title={t('settingTool.crawler.title')}
          />
        </Flexbox>
      </AsyncBoundary>
    </>
  );
});

export default ToolSetting;

'use client';

import { Form, type FormGroupItem, useForm } from '@lobehub/ui/base-ui/form';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { SettingsSectionSkeleton } from '@/components/Skeleton';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/slices/settings/selectors';
import { type UserGeneralConfig } from '@/types/user/settings';

import Preview from './Preview';
import { ThemeSwatchesNeutral, ThemeSwatchesPrimary } from './ThemeSwatches';

const Appearance = memo(() => {
  const { t } = useTranslation('setting');
  const { general } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();
  const form = useForm({
    initialValues: general,
    values: general,
    onValuesChange: (value) => save(() => setSettings({ general: value })),
  });

  if (!isUserStateInit) return <SettingsSectionSkeleton />;

  const theme: FormGroupItem<UserGeneralConfig> = {
    children: [
      {
        children: <Preview />,
        label: t('settingAppearance.preview.title'),
        minWidth: undefined,
      },
      {
        children: <ThemeSwatchesPrimary />,
        label: (
          <SettingsSearchAnchor id={'appearance-primary-color'}>
            {t('settingAppearance.primaryColor.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
        name: 'primaryColor',
      },
      {
        children: <ThemeSwatchesNeutral />,
        label: (
          <SettingsSearchAnchor id={'appearance-neutral-color'}>
            {t('settingAppearance.neutralColor.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
        name: 'neutralColor',
      },
    ],
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('settingAppearance.title'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      items={[theme]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default Appearance;

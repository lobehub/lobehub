'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Skeleton } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE } from '@/const/layoutTokens';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/slices/settings/selectors';

import Preview from './Preview';
import { ThemeSwatchesNeutral, ThemeSwatchesPrimary } from './ThemeSwatches';

const Appearance = memo(() => {
  const { t } = useTranslation('setting');
  const { general } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const theme: FormGroupItemType = {
    children: [
      {
        children: <Preview />,
        label: t('settingAppearance.preview.title'),
        minWidth: undefined,
      },
      {
        children: <ThemeSwatchesPrimary />,
        desc: t('settingAppearance.primaryColor.desc'),
        label: t('settingAppearance.primaryColor.title'),
        minWidth: undefined,
        name: 'primaryColor',
      },
      {
        children: <ThemeSwatchesNeutral />,
        desc: t('settingAppearance.neutralColor.desc'),
        label: t('settingAppearance.neutralColor.title'),
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
      initialValues={general}
      items={[theme]}
      itemsType={'group'}
      variant={'filled'}
      onValuesChange={(value) => save(() => setSettings({ general: value }))}
      {...FORM_STYLE}
    />
  );
});

export default Appearance;

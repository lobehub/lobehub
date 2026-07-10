'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Flexbox, Form, Icon, ImageSelect, Skeleton } from '@lobehub/ui';
import { Select, Tabs } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { Ban, Gauge, Monitor, Moon, Mouse, Sun, Waves } from 'lucide-react';
import { useTheme as useNextThemesTheme } from 'next-themes';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE } from '@/const/layoutTokens';
import { imageUrl } from '@/const/url';
import { isDesktop } from '@/const/version';
import { useSaveState } from '@/hooks/useSaveState';
import { localeOptions } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type LocaleMode } from '@/types/locale';

const Common = memo(() => {
  const { t } = useTranslation('setting');

  const general = useUserStore((s) => settingsSelectors.currentSettings(s).general, isEqual);
  const { theme, setTheme } = useNextThemesTheme();
  const language = useGlobalStore(systemStatusSelectors.language);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [switchLocale, isStatusInit] = useGlobalStore((s) => [s.switchLocale, s.isStatusInit]);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();

  // Use the theme value from next-themes, default to 'system'
  const currentTheme = theme || 'system';

  const handleLangChange = (value: LocaleMode) => {
    switchLocale(value);
  };

  if (!(isStatusInit && isUserStateInit))
    return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const themeFormGroup: FormGroupItemType = {
    children: [
      {
        children: (
          <ImageSelect
            height={60}
            unoptimized={isDesktop}
            value={currentTheme}
            width={100}
            options={[
              {
                icon: Sun,
                img: imageUrl('theme_light.webp'),
                label: t('settingCommon.themeMode.light'),
                value: 'light',
              },
              {
                icon: Moon,
                img: imageUrl('theme_dark.webp'),
                label: t('settingCommon.themeMode.dark'),
                value: 'dark',
              },
              {
                icon: Monitor,
                img: imageUrl('theme_auto.webp'),
                label: t('settingCommon.themeMode.auto'),
                value: 'system',
              },
            ]}
            onChange={(value) => setTheme(value === 'auto' ? 'system' : value)}
          />
        ),
        label: t('settingCommon.themeMode.title'),
        minWidth: undefined,
      },
      {
        children: (
          <Flexbox horizontal justify={'flex-end'}>
            <Select
              defaultValue={language}
              options={[
                { label: t('settingCommon.lang.autoMode'), value: 'auto' },
                ...localeOptions,
              ]}
              style={{
                width: '50%',
              }}
              onChange={handleLangChange}
            />
          </Flexbox>
        ),
        label: t('settingCommon.lang.title'),
      },
      {
        children: (
          <Tabs
            items={[
              {
                icon: <Icon icon={Ban} size={16} />,
                key: 'disabled',
                label: t('settingAppearance.animationMode.disabled'),
              },
              {
                icon: <Icon icon={Gauge} size={16} />,
                key: 'agile',
                label: t('settingAppearance.animationMode.agile'),
              },
              {
                icon: <Icon icon={Waves} size={16} />,
                key: 'elegant',
                label: t('settingAppearance.animationMode.elegant'),
              },
            ]}
          />
        ),
        desc: t('settingAppearance.animationMode.desc'),
        label: t('settingAppearance.animationMode.title'),
        minWidth: undefined,
        name: 'animationMode',
        valuePropName: 'activeKey',
      },
      {
        children: (
          <Tabs
            items={[
              {
                icon: <Icon icon={Ban} size={16} />,
                key: 'disabled',
                label: t('settingAppearance.contextMenuMode.disabled'),
              },
              {
                icon: <Icon icon={Mouse} size={16} />,
                key: 'default',
                label: t('settingAppearance.contextMenuMode.default'),
              },
            ]}
          />
        ),
        desc: t('settingAppearance.contextMenuMode.desc'),
        label: t('settingAppearance.contextMenuMode.title'),
        minWidth: undefined,
        name: 'contextMenuMode',
        valuePropName: 'activeKey',
      },

      {
        children: (
          <Flexbox horizontal justify={'flex-end'}>
            <Select
              allowClear
              options={localeOptions}
              placeholder={t('settingCommon.responseLanguage.placeholder')}
              value={general?.responseLanguage || undefined}
              style={{
                width: '50%',
              }}
              onChange={(value) => {
                save(() => setSettings({ general: { responseLanguage: value ?? '' } }));
              }}
            />
          </Flexbox>
        ),
        desc: t('settingCommon.responseLanguage.desc'),
        label: t('settingCommon.responseLanguage.title'),
      },
    ],
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('settingCommon.title'),
  };

  return (
    <Form
      collapsible={false}
      initialValues={general}
      items={[themeFormGroup]}
      itemsType={'group'}
      variant={'filled'}
      onValuesChange={(v) => save(() => setSettings({ general: v }))}
      {...FORM_STYLE}
    />
  );
});

export default Common;

'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Flexbox, Form, Icon, ImageSelect, LobeSelect as Select, Skeleton } from '@lobehub/ui';
import { Segmented, Switch } from 'antd';
import isEqual from 'fast-deep-equal';
import { Ban, Gauge, Loader2Icon, Monitor, Moon, Mouse, Sun, Waves } from 'lucide-react';
import { useTheme as useNextThemesTheme } from 'next-themes';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { imageUrl } from '@/const/url';
import { isDesktop } from '@/const/version';
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
  const [loading, setLoading] = useState(false);

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
          <Segmented
            options={[
              {
                icon: <Icon icon={Ban} size={16} />,
                label: t('settingAppearance.animationMode.disabled'),
                value: 'disabled',
              },
              {
                icon: <Icon icon={Gauge} size={16} />,
                label: t('settingAppearance.animationMode.agile'),
                value: 'agile',
              },
              {
                icon: <Icon icon={Waves} size={16} />,
                label: t('settingAppearance.animationMode.elegant'),
                value: 'elegant',
              },
            ]}
          />
        ),
        desc: t('settingAppearance.animationMode.desc'),
        label: t('settingAppearance.animationMode.title'),
        minWidth: undefined,
        name: 'animationMode',
      },
      {
        children: (
          <Segmented
            options={[
              {
                icon: <Icon icon={Ban} size={16} />,
                label: t('settingAppearance.contextMenuMode.disabled'),
                value: 'disabled',
              },
              {
                icon: <Icon icon={Mouse} size={16} />,
                label: t('settingAppearance.contextMenuMode.default'),
                value: 'default',
              },
            ]}
          />
        ),
        desc: t('settingAppearance.contextMenuMode.desc'),
        label: t('settingAppearance.contextMenuMode.title'),
        minWidth: undefined,
        name: 'contextMenuMode',
      },

      {
        children: (
          <Flexbox horizontal justify={'flex-end'}>
            <Select
              placeholder={t('settingCommon.responseLanguage.placeholder')}
              options={[
                { label: t('settingCommon.responseLanguage.auto'), value: '' },
                ...localeOptions,
              ]}
              style={{
                width: '50%',
              }}
            />
          </Flexbox>
        ),
        desc: t('settingCommon.responseLanguage.desc'),
        label: t('settingCommon.responseLanguage.title'),
        name: 'responseLanguage',
      },
      {
        children: <Switch />,
        desc: t('settingCommon.liteMode.desc'),
        label: t('settingCommon.liteMode.title'),
        minWidth: undefined,
        name: 'isLiteMode',
        valuePropName: 'checked',
      },
      {
        children: <Switch />,
        desc: t('settingCommon.devMode.desc'),
        label: t('settingCommon.devMode.title'),
        minWidth: undefined,
        name: 'isDevMode',
        valuePropName: 'checked',
      },
    ],
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('settingCommon.title'),
  };

  return (
    <Form
      collapsible={false}
      initialValues={general}
      items={[themeFormGroup]}
      itemsType={'group'}
      variant={'filled'}
      onValuesChange={async (v) => {
        setLoading(true);
        await setSettings({ general: v });
        setLoading(false);
      }}
      {...FORM_STYLE}
    />
  );
});

export default Common;

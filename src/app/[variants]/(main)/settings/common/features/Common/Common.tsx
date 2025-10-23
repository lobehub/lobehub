'use client';

import { Form, type FormGroupItemType, Icon, ImageSelect, InputPassword } from '@lobehub/ui';
import { Select } from '@lobehub/ui';
import { Segmented, Skeleton } from 'antd';
import isEqual from 'fast-deep-equal';
import { Ban, Gauge, Loader2Icon, Monitor, Moon, Sun, Waves } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { imageUrl } from '@/const/url';
import { localeOptions } from '@/locales/resources';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { LocaleMode } from '@/types/locale';

const Common = memo(() => {
  const { t } = useTranslation('setting');

  const showAccessCodeConfig = useServerConfigStore(serverConfigSelectors.enabledAccessCode);
  const general = useUserStore((s) => settingsSelectors.currentSettings(s).general, isEqual);
  const themeMode = useGlobalStore(systemStatusSelectors.themeMode);
  const language = useGlobalStore(systemStatusSelectors.language);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [setThemeMode, switchLocale, isStatusInit] = useGlobalStore((s) => [
    s.switchThemeMode,
    s.switchLocale,
    s.isStatusInit,
  ]);
  const [loading, setLoading] = useState(false);

  const handleLangChange = (value: LocaleMode) => {
    switchLocale(value);
  };

  if (!(isStatusInit && isUserStateInit))
    return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const theme: FormGroupItemType = {
    children: [
      {
        children: (
          <ImageSelect
            height={60}
            onChange={setThemeMode}
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
                value: 'auto',
              },
            ]}
            unoptimized={false}
            value={themeMode}
            width={100}
          />
        ),
        label: t('settingCommon.themeMode.title'),
        minWidth: undefined,
      },
      {
        children: (
          <Select
            defaultValue={language}
            onChange={handleLangChange}
            options={[{ label: t('settingCommon.lang.autoMode'), value: 'auto' }, ...localeOptions]}
          />
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
          <InputPassword
            autoComplete={'new-password'}
            placeholder={t('settingSystem.accessCode.placeholder')}
          />
        ),
        desc: t('settingSystem.accessCode.desc'),
        hidden: !showAccessCodeConfig,
        label: t('settingSystem.accessCode.title'),
        name: 'password',
      },
    ],
    extra: loading && <Icon icon={Loader2Icon} size={16} spin style={{ opacity: 0.5 }} />,
    title: t('settingCommon.title'),
  };

  return (
    <Form
      initialValues={general}
      items={[theme]}
      itemsType={'group'}
      onValuesChange={async (v) => {
        setLoading(true);
        await setSettings({ general: v });
        setLoading(false);
      }}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
});

export default Common;

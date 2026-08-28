'use client';

import { isDesktop } from '@lobechat/const';
import type { FormGroupItemType } from '@lobehub/ui';
import { Form } from '@lobehub/ui';
import { Select } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AutoSaveHint from '@/components/Editor/AutoSaveHint';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useSaveState } from '@/hooks/useSaveState';
import { useUserStore } from '@/store/user';
import { preferenceSelectors } from '@/store/user/selectors';

import { APPLICATION_DEFAULT_FONT, useSystemFontOptions } from '../useSystemFontOptions';

const FontSettings = memo(() => {
  const { t } = useTranslation('setting');
  const [fontFamily, monospaceFontFamily] = useUserStore((s) => [
    preferenceSelectors.fontFamily(s),
    preferenceSelectors.terminalFontFamily(s),
  ]);
  const updatePreference = useUserStore((s) => s.updatePreference);
  const { status: saveStatus, lastSavedAt, save, retry } = useSaveState();

  const interfaceFonts = useSystemFontOptions({
    defaultLabel: t('settingAppearance.font.fontFamily.default'),
    unavailableLabel: (font) => t('settingAppearance.font.fontFamily.unavailable', { font }),
    value: fontFamily,
  });
  const monospaceFonts = useSystemFontOptions({
    defaultLabel: t('settingAppearance.font.monospace.default'),
    monospaceOnly: true,
    unavailableLabel: (font) => t('settingAppearance.font.monospace.unavailable', { font }),
    value: monospaceFontFamily,
  });

  const font: FormGroupItemType = {
    children: [
      {
        children: (
          <Select
            showSearch
            aria-label={t('settingAppearance.font.fontFamily.title')}
            loading={interfaceFonts.isLoading}
            options={interfaceFonts.options}
            style={{ width: 320 }}
            value={fontFamily || APPLICATION_DEFAULT_FONT}
            onChange={(value: string) =>
              save(() =>
                updatePreference({ fontFamily: value === APPLICATION_DEFAULT_FONT ? '' : value }),
              )
            }
          />
        ),
        desc: interfaceFonts.hasLoadError
          ? t('settingAppearance.font.fontFamily.loadError')
          : t('settingAppearance.font.fontFamily.desc'),
        label: (
          <SettingsSearchAnchor id={'appearance-font-family'}>
            {t('settingAppearance.font.fontFamily.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
      {
        children: (
          <Select
            showSearch
            aria-label={t('settingAppearance.font.monospace.title')}
            loading={monospaceFonts.isLoading}
            options={monospaceFonts.options}
            style={{ width: 320 }}
            value={monospaceFontFamily || APPLICATION_DEFAULT_FONT}
            onChange={(value: string) =>
              save(() =>
                updatePreference({
                  terminalFontFamily: value === APPLICATION_DEFAULT_FONT ? '' : value,
                }),
              )
            }
          />
        ),
        desc: monospaceFonts.hasLoadError
          ? t('settingAppearance.font.monospace.loadError')
          : t('settingAppearance.font.monospace.desc'),
        label: (
          <SettingsSearchAnchor id={'appearance-monospace-font'}>
            {t('settingAppearance.font.monospace.title')}
          </SettingsSearchAnchor>
        ),
        minWidth: undefined,
      },
    ],
    extra: <AutoSaveHint lastUpdatedTime={lastSavedAt} saveStatus={saveStatus} onRetry={retry} />,
    title: t('settingAppearance.font.title'),
  };

  return (
    <Form
      collapsible={false}
      items={[font]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

const Font = () => {
  if (!isDesktop) return null;

  return <FontSettings />;
};

export default Font;

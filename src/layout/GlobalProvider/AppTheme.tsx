'use client';

import '@lobehub/ui/theme.css';
import '@lobehub/ui/global.css';
import '@lobehub/ui/style.css';
import '@/styles/global.css';

import { type NeutralColors, type PrimaryColors } from '@lobehub/ui';
import { ConfigProvider, FontLoader, setLobeTheme } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import * as m from 'motion/react-m';
import { type ReactNode } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';

import Link from '@/components/Link';
import { genFontFamily, genFontFamilyCode } from '@/const/font';
import { LOBE_THEME_NEUTRAL_COLOR, LOBE_THEME_PRIMARY_COLOR } from '@/const/theme';
import { getUILocaleAndResources } from '@/libs/getUILocaleAndResources';
import type { UILocaleResources } from '@/libs/getUILocaleAndResources.utils';
import { resolveUILocale } from '@/libs/getUILocaleAndResources.utils';
import Image from '@/libs/next/Image';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';
import { sx } from '@/styles/sx';
import { setCookie } from '@/utils/client/cookie';

import moduleStyles from './AppTheme.module.css';

const styles = stylex.create({
  app: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    height: '100%',
    minHeight: '100dvh',
    maxHeight: '100dvh',
    overflow: { 'default': null, '@media (min-device-width: 576px)': 'hidden' },
  },
});

export interface AppThemeProps {
  children?: ReactNode;
  customFontFamily?: string;
  customFontURL?: string;
  defaultNeutralColor?: NeutralColors;
  defaultPrimaryColor?: PrimaryColors;
  globalCDN?: boolean;
}

const AppTheme = memo<AppThemeProps>(
  ({
    children,
    defaultPrimaryColor,
    defaultNeutralColor,
    globalCDN,
    customFontURL,
    customFontFamily,
  }) => {
    const language = useGlobalStore(systemStatusSelectors.language);
    const [primaryColor, neutralColor, fontAntialiasing] = useUserStore((s) => [
      userGeneralSettingsSelectors.primaryColor(s),
      userGeneralSettingsSelectors.neutralColor(s),
      userGeneralSettingsSelectors.fontAntialiasing(s),
    ]);
    const [userFontFamily, userFontFamilyCode] = useUserStore((s) => [
      preferenceSelectors.fontFamily(s),
      preferenceSelectors.terminalFontFamily(s),
    ]);
    const fontFamily = useMemo(
      () =>
        genFontFamily({
          customFontFamily,
          locale: resolveUILocale(language).normalizedLocale,
          userFontFamily,
        }),
      [customFontFamily, language, userFontFamily],
    );
    const fontFamilyCode = useMemo(
      () =>
        genFontFamilyCode({
          locale: resolveUILocale(language).normalizedLocale,
          userFontFamily: userFontFamilyCode,
        }),
      [language, userFontFamilyCode],
    );
    const [uiResources, setUIResources] = useState<UILocaleResources>();
    const [uiLocale, setUILocale] = useState(() => resolveUILocale(language).uiLocale);

    useEffect(() => {
      let mounted = true;
      setUILocale(resolveUILocale(language).uiLocale);
      getUILocaleAndResources(language)
        .then(({ locale, resources }) => {
          if (mounted) {
            setUILocale(locale);
            setUIResources(resources);
          }
        })
        .catch((error) => {
          console.error('Failed to load UI locale resources:', error);
        });
      return () => {
        mounted = false;
      };
    }, [language]);

    useEffect(() => {
      setCookie(LOBE_THEME_PRIMARY_COLOR, primaryColor);
    }, [primaryColor]);

    useEffect(() => {
      setLobeTheme({
        neutralColor: neutralColor ?? defaultNeutralColor,
        primaryColor: primaryColor ?? defaultPrimaryColor,
      });
    }, [primaryColor, neutralColor, defaultPrimaryColor, defaultNeutralColor]);

    useEffect(() => {
      const { style } = document.documentElement;
      style.setProperty('--lobe-font-family', fontFamily);
      style.setProperty('--lobe-font-family-code', fontFamilyCode);
    }, [fontFamily, fontFamilyCode]);

    useEffect(() => {
      setCookie(LOBE_THEME_NEUTRAL_COLOR, neutralColor);
    }, [neutralColor]);

    useEffect(() => {
      if (fontAntialiasing) delete document.documentElement.dataset.fontAntialiasing;
      else document.documentElement.dataset.fontAntialiasing = 'off';
    }, [fontAntialiasing]);

    return (
      <ConfigProvider
        locale={uiLocale}
        motion={m}
        resources={uiResources}
        config={{
          aAs: Link,
          imgAs: Image,
          imgUnoptimized: true,
          proxy: globalCDN ? 'unpkg' : undefined,
        }}
      >
        <div {...sx([styles.app], moduleStyles.scrollbar)}>
          {!!customFontURL && <FontLoader url={customFontURL} />}
          {children}
        </div>
      </ConfigProvider>
    );
  },
);

export default AppTheme;

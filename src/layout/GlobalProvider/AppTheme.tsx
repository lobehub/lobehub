'use client';

import 'antd/dist/reset.css';

import { type NeutralColors, type PrimaryColors } from '@lobehub/ui';
import { ConfigProvider, FontLoader, ThemeProvider } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import * as m from 'motion/react-m';
import { type ReactNode } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';

import AntdStaticMethods from '@/components/AntdStaticMethods';
import Link from '@/components/Link';
import { genFontFamily, genFontFamilyCode } from '@/const/font';
import { LOBE_THEME_NEUTRAL_COLOR, LOBE_THEME_PRIMARY_COLOR } from '@/const/theme';
import { useIsDark } from '@/hooks/useIsDark';
import { getUILocaleAndResources } from '@/libs/getUILocaleAndResources';
import type { UILocaleResources } from '@/libs/getUILocaleAndResources.utils';
import { resolveUILocale } from '@/libs/getUILocaleAndResources.utils';
import Image from '@/libs/next/Image';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { preferenceSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';
import { GlobalStyle } from '@/styles';
import { setCookie } from '@/utils/client/cookie';

const styles = createStaticStyles(({ css, cssVar }) => ({
  app: css`
    position: relative;

    overscroll-behavior: none;
    display: flex;
    flex-direction: column;
    align-items: center;

    height: 100%;
    min-height: 100dvh;
    max-height: 100dvh;

    @media (device-width >= 576px) {
      overflow: hidden;
    }
  `,
  // scrollbar-width and scrollbar-color are supported from Chrome 121
  // https://developer.mozilla.org/en-US/docs/Web/CSS/scrollbar-color
  scrollbar: css`
    scrollbar-color: ${cssVar.colorFill} transparent;
    scrollbar-width: thin;

    #lobe-mobile-scroll-container {
      scrollbar-width: none;

      ::-webkit-scrollbar {
        width: 0;
        height: 0;
      }
    }
  `,

  // so this is a polyfill for older browsers
  scrollbarPolyfill: css`
    ::-webkit-scrollbar {
      width: 0.75em;
      height: 0.75em;
    }

    ::-webkit-scrollbar-thumb {
      border-radius: 10px;
    }

    :hover::-webkit-scrollbar-thumb {
      border: 3px solid transparent;
      background-color: ${cssVar.colorText};
      background-clip: content-box;
    }

    ::-webkit-scrollbar-track {
      background-color: transparent;
    }
  `,
}));

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
    const isDark = useIsDark();

    const [primaryColor, neutralColor, animationMode] = useUserStore((s) => [
      userGeneralSettingsSelectors.primaryColor(s),
      userGeneralSettingsSelectors.neutralColor(s),
      userGeneralSettingsSelectors.animationMode(s),
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
      setCookie(LOBE_THEME_NEUTRAL_COLOR, neutralColor);
    }, [neutralColor]);

    const currentAppearence = isDark ? 'dark' : 'light';

    return (
      <ThemeProvider
        appearance={currentAppearence}
        className={cx(styles.app, styles.scrollbar, styles.scrollbarPolyfill)}
        defaultAppearance={currentAppearence}
        defaultThemeMode={currentAppearence}
        customTheme={{
          neutralColor: neutralColor ?? defaultNeutralColor,
          primaryColor: primaryColor ?? defaultPrimaryColor,
        }}
        theme={{
          cssVar: { key: 'lobe-vars' },
          token: {
            fontFamily,
            fontFamilyCode,
            motion: animationMode !== 'disabled',
            motionUnit: animationMode === 'agile' ? 0.05 : 0.1,
          },
        }}
      >
        {!!customFontURL && <FontLoader url={customFontURL} />}
        <GlobalStyle />
        <AntdStaticMethods />
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
          {children}
        </ConfigProvider>
      </ThemeProvider>
    );
  },
);

export default AppTheme;

'use client';

import 'antd/dist/reset.css';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { type NeutralColors, type PrimaryColors } from '@lobehub/ui';
import { ConfigProvider, FontLoader, ThemeProvider } from '@lobehub/ui';
import { message as antdMessage } from 'antd';
import { AppConfigContext } from 'antd/es/app/context';
import { createStaticStyles, cx, useTheme } from 'antd-style';
import * as motion from 'motion/react-m';
import { type ReactNode } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';

import AntdStaticMethods from '@/components/AntdStaticMethods';
import Link from '@/components/Link';
import { LOBE_THEME_NEUTRAL_COLOR, LOBE_THEME_PRIMARY_COLOR } from '@/const/theme';
import { isDesktop } from '@/const/version';
import { useIsDark } from '@/hooks/useIsDark';
import { getUILocaleAndResources } from '@/libs/getUILocaleAndResources';
import Image from '@/libs/next/Image';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
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
    const antdTheme = useTheme();
    const isDark = useIsDark();

    const [primaryColor, neutralColor, animationMode] = useUserStore((s) => [
      userGeneralSettingsSelectors.primaryColor(s),
      userGeneralSettingsSelectors.neutralColor(s),
      userGeneralSettingsSelectors.animationMode(s),
    ]);
    const messageTop = isDesktop ? TITLE_BAR_HEIGHT + 8 : undefined;
    const appConfig = useMemo(
      () => (messageTop === undefined ? {} : { message: { top: messageTop } }),
      [messageTop],
    );

    const [uiResources, setUIResources] = useState<any>(null);
    const uiLocale = useMemo(() => {
      if (language.startsWith('zh')) return 'zh-CN';
      if (language.startsWith('en')) return 'en-US';
      return 'en-US';
    }, [language]);

    useEffect(() => {
      let mounted = true;
      getUILocaleAndResources(language).then(({ resources }) => {
        if (mounted) {
          setUIResources(resources);
        }
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

    useEffect(() => {
      if (messageTop === undefined) return;
      antdMessage.config({ top: messageTop });
    }, [messageTop]);

    const currentAppearence = isDark ? 'dark' : 'light';

    return (
      <AppConfigContext value={appConfig}>
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
              fontFamily: customFontFamily
                ? `${customFontFamily},${antdTheme.fontFamily}`
                : undefined,
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
            motion={motion}
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
      </AppConfigContext>
    );
  },
);

export default AppTheme;

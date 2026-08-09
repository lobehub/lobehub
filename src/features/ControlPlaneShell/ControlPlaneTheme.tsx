'use client';

import 'antd/dist/reset.css';

import ConfigProvider from '@lobehub/ui/es/ConfigProvider/index';
import FontLoader from '@lobehub/ui/es/FontLoader/index';
import ThemeProvider from '@lobehub/ui/es/ThemeProvider/index';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { domMax, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { memo, type PropsWithChildren, useEffect } from 'react';

import AntdStaticMethods from '@/components/AntdStaticMethods';
import { useIsDark } from '@/hooks/useIsDark';
import { useLocaleThemeFont } from '@/hooks/useLocaleThemeFont';
import Image from '@/libs/next/Image';
import Link from '@/libs/next/Link';

/** Full-viewport panel surface — no darker colorBgLayout header/footer bands. */
const styles = createStaticStyles(({ css, cssVar: v }) => ({
  root: css`
    width: 100%;
    height: 100%;
    min-height: 100dvh;
    background: ${v.colorBgContainer} !important;
  `,
}));

/** Align layout chrome with Lobe container surfaces used by panels. */
const LAYOUT_AS_CONTAINER = {
  dark: { colorBgLayout: '#0d0d0d' },
  light: { colorBgLayout: '#f8f8f8' },
} as const;

const ControlPlaneTheme = memo<PropsWithChildren>(({ children }) => {
  const isDark = useIsDark();
  const appearance = isDark ? 'dark' : 'light';
  const { fontFamily, fontURL } = useLocaleThemeFont();

  useEffect(() => {
    const apply = () => {
      const el = document.querySelector('.control-plane-layout');
      const bg = el ? getComputedStyle(el).backgroundColor : '';
      if (!bg || bg === 'rgba(0, 0, 0, 0)') return;
      document.documentElement.style.backgroundColor = bg;
      document.body.style.backgroundColor = bg;
      const root = document.getElementById('root');
      if (root) root.style.backgroundColor = bg;
    };
    apply();
    const id = requestAnimationFrame(apply);
    return () => {
      cancelAnimationFrame(id);
      document.documentElement.style.backgroundColor = '';
      document.body.style.backgroundColor = '';
      const root = document.getElementById('root');
      if (root) root.style.backgroundColor = '';
    };
  }, [appearance]);

  return (
    <ThemeProvider
      appearance={appearance}
      className={`control-plane-layout ${styles.root}`}
      defaultAppearance={appearance}
      defaultThemeMode={appearance}
      style={{
        background: cssVar.colorBgContainer,
        height: '100%',
        minHeight: '100dvh',
        width: '100%',
      }}
      theme={{
        cssVar: { key: 'lobe-vars' },
        token: {
          fontFamily,
          ...LAYOUT_AS_CONTAINER[appearance],
        },
      }}
    >
      {!!fontURL && <FontLoader url={fontURL} />}
      <App className={styles.root} style={{ background: cssVar.colorBgContainer, height: '100%' }}>
        <AntdStaticMethods />
        <ConfigProvider config={{ aAs: Link, imgAs: Image, imgUnoptimized: true }} motion={m}>
          <LazyMotion features={domMax}>{children}</LazyMotion>
        </ConfigProvider>
      </App>
    </ThemeProvider>
  );
});

ControlPlaneTheme.displayName = 'ControlPlaneTheme';

export default ControlPlaneTheme;

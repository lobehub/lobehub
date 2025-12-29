'use client';

import { dark } from '@clerk/themes';
import { type ElementsConfig, type Theme } from '@clerk/types';
import { BRANDING_URL } from '@lobechat/business-const';
import { createStaticStyles, cssVar, cx, useThemeMode } from 'antd-style';

const prefixCls = 'cl';

const styles = createStaticStyles(({ css, cssVar }) => ({
  avatarBox: css`
    width: 40px;
    height: 40px;
  `,
  cardBox: css`
    border-radius: ${cssVar.borderRadiusLG}px;
    background: ${cssVar.colorBgContainer};
    box-shadow: 0 0 0 1px ${cssVar.colorBorderSecondary};
  `,
  header: css`
    gap: 1em;
  `,
  logoBox: css`
    height: 48px;
  `,
  modalBackdrop: css`
    background: ${cssVar.colorBgMask};
  `,
  modalContent: css`
    &.${prefixCls}-modalContent {
      .${prefixCls}-cardBox {
        border: 1px solid ${cssVar.colorSplit} !important;
        border-radius: ${cssVar.borderRadiusLG}px !important;
        box-shadow: ${cssVar.boxShadow} !important;
      }

      .${prefixCls}-userProfile-root {
        width: min(80vw, 55rem);
        height: min(80vh, 44rem);
      }
    }
  `,
  navbar: css`
    background: ${cssVar.colorFillTertiary};

    @media (max-width: 768px) {
      background: ${cssVar.colorBgContainer};
    }
  `,
  navbarButton: css`
    line-height: 2;
  `,
  navbar_dark: css`
    background: ${cssVar.colorBgContainer};
  `,
  pageScrollBox: css`
    align-self: center;
    width: 100%;
    max-width: 1024px;
  `,
  rootBox: css`
    &.${prefixCls}-userProfile-root {
      width: 100%;
      height: 100%;

      .${prefixCls}-cardBox {
        width: 100%;
        height: 100%;
        border: unset;
        border-radius: unset;

        box-shadow: unset;
      }
    }
  `,
  scrollBox: css`
    border: unset;
    border-radius: unset;
    background: ${cssVar.colorBgElevated};
    box-shadow: 0 1px 0 1px ${cssVar.colorFillTertiary};
  `,
  scrollBox_dark: css`
    background: ${cssVar.colorFillQuaternary};
  `,
  socialButtons: css`
    display: flex;
    flex-direction: column;
  `,
  socialButtonsBlockButton__github: css`
    order: 1;
  `,
  socialButtonsBlockButton__google: css`
    order: -1;
  `,
})) as Partial<Record<keyof ElementsConfig, any>>;

export const useAppearance = () => {
  const { isDarkMode } = useThemeMode();

  const navbarStyle = cx(styles.navbar, isDarkMode && (styles as any).navbar_dark);
  const scrollBoxStyle = cx(styles.scrollBox, isDarkMode && (styles as any).scrollBox_dark);

  const elements = {
    ...styles,
    navbar: navbarStyle,
    scrollBox: scrollBoxStyle,
  } as Partial<Record<keyof ElementsConfig, any>>;

  return {
    baseTheme: isDarkMode ? dark : undefined,
    elements,
    layout: {
      helpPageUrl: BRANDING_URL.help ?? 'https://lobehub.com/docs',
      privacyPageUrl: BRANDING_URL.privacy ?? 'https://lobehub.com/privacy',
      socialButtonsVariant: 'blockButton',
      termsPageUrl: BRANDING_URL.terms ?? 'https://lobehub.com/terms',
    },
    variables: {
      borderRadius: cssVar.borderRadius,
      colorBackground: cssVar.colorBgContainer,
      colorDanger: cssVar.colorError,
      colorInputBackground: cssVar.colorFillTertiary,
      colorNeutral: cssVar.colorText,
      colorSuccess: cssVar.colorSuccess,
      colorText: cssVar.colorText,
      colorTextSecondary: cssVar.colorTextDescription,
      colorWarning: cssVar.colorWarning,
      fontSize: cssVar.fontSize,
    },
  } as Theme;
};

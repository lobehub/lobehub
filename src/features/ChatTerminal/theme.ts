import type { ITheme } from '@xterm/xterm';

interface XtermThemeTokens {
  colorBgContainer: string;
  colorText: string;
  isDarkMode: boolean;
}

/**
 * 16-color ANSI palettes. The design system has no ANSI tokens, so these are
 * curated per appearance; everything else (background / foreground / cursor /
 * selection) follows the antd theme tokens and flips with light/dark for free.
 */
const DARK_ANSI = {
  black: '#3c3c3c',
  blue: '#3b8eea',
  brightBlack: '#666666',
  brightBlue: '#66aef5',
  brightCyan: '#29b8db',
  brightGreen: '#23d18b',
  brightMagenta: '#d670d6',
  brightRed: '#f14c4c',
  brightWhite: '#ffffff',
  brightYellow: '#f5f543',
  cyan: '#11a8cd',
  green: '#0dbc79',
  magenta: '#bc3fbc',
  red: '#cd3131',
  white: '#e5e5e5',
  yellow: '#e5e510',
} satisfies Partial<ITheme>;

const LIGHT_ANSI = {
  black: '#000000',
  blue: '#0451a5',
  brightBlack: '#666666',
  brightBlue: '#0451a5',
  brightCyan: '#0598bc',
  brightGreen: '#14ce14',
  brightMagenta: '#bc05bc',
  brightRed: '#cd3131',
  brightWhite: '#a5a5a5',
  brightYellow: '#b5ba00',
  cyan: '#0598bc',
  green: '#00bc00',
  magenta: '#bc05bc',
  red: '#cd3131',
  white: '#555555',
  yellow: '#949800',
} satisfies Partial<ITheme>;

export const buildXtermTheme = (token: XtermThemeTokens): ITheme => ({
  ...(token.isDarkMode ? DARK_ANSI : LIGHT_ANSI),
  background: token.colorBgContainer,
  cursor: token.colorText,
  cursorAccent: token.colorBgContainer,
  foreground: token.colorText,
  selectionBackground: token.isDarkMode ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.15)',
});

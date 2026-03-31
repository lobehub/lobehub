import { isDesktop } from '@lobechat/const';

import { DEFAULT_LANG } from '@/const/locale';
import { type Locales, normalizeLocale } from '@/locales/resources';
import { isOnServerSide } from '@/utils/env';

import { type UserStore } from '../../../store';
import { currentSettings } from './settings';

const generalConfig = (s: UserStore) => currentSettings(s).general || {};

const neutralColor = (s: UserStore) => generalConfig(s).neutralColor;
const primaryColor = (s: UserStore) => generalConfig(s).primaryColor;
const fontSize = (s: UserStore) => generalConfig(s).fontSize;
const highlighterTheme = (s: UserStore) => generalConfig(s).highlighterTheme;
const mermaidTheme = (s: UserStore) => generalConfig(s).mermaidTheme;
const transitionMode = (s: UserStore) => generalConfig(s).transitionMode;
const animationMode = (s: UserStore) => generalConfig(s).animationMode;
const contextMenuMode = (s: UserStore) => {
  const config = generalConfig(s).contextMenuMode;
  if (config !== undefined) return config;
  return isDesktop ? 'default' : 'disabled';
};
const responseLanguage = (s: UserStore) => generalConfig(s).responseLanguage;
const currentResponseLanguage = (s: UserStore): Locales => {
  const locale = responseLanguage(s);

  if (locale) return normalizeLocale(locale);
  if (isOnServerSide) return DEFAULT_LANG;

  return normalizeLocale(navigator.language);
};
const telemetry = (s: UserStore) => generalConfig(s).telemetry;
const enableAutoScrollOnStreaming = (s: UserStore) =>
  generalConfig(s).enableAutoScrollOnStreaming ?? true;

export const userGeneralSettingsSelectors = {
  animationMode,
  config: generalConfig,
  contextMenuMode,
  enableAutoScrollOnStreaming,
  fontSize,
  highlighterTheme,
  mermaidTheme,
  neutralColor,
  primaryColor,
  currentResponseLanguage,
  responseLanguage,
  telemetry,
  transitionMode,
};

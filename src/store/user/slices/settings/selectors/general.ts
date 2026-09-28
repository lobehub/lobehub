import { isDesktop } from '@lobechat/const';

import { DEFAULT_LANG } from '@/const/locale';
import { type Locales, normalizeLocale } from '@/locales/resources';
import { getSystemLanguage } from '@/utils/client/systemLanguage';
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

  return normalizeLocale(getSystemLanguage());
};
const telemetry = (s: UserStore) => generalConfig(s).telemetry;
const timezone = (s: UserStore) => generalConfig(s).timezone;
/** The user's timezone setting, falling back to the browser's. */
const currentTimezone = (s: UserStore): string | undefined =>
  timezone(s) ||
  (typeof Intl === 'undefined' ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone);
const enableAutoScrollOnStreaming = (s: UserStore) =>
  generalConfig(s).enableAutoScrollOnStreaming ?? true;
const enableMessageLinkIcon = (s: UserStore) => generalConfig(s).enableMessageLinkIcon ?? true;
/** The setting is a boolean: either the live tool list is open or it is a
 *  summary row. "Open" means the full list — the height-capped middle level
 *  just hid part of what the user asked to see. */
const workflowStreamingExpandLevel = (s: UserStore) =>
  generalConfig(s).expandWorkflowWhileStreaming ? 'full' : 'collapsed';

export const userGeneralSettingsSelectors = {
  animationMode,
  config: generalConfig,
  contextMenuMode,
  enableAutoScrollOnStreaming,
  enableMessageLinkIcon,
  fontSize,
  highlighterTheme,
  mermaidTheme,
  neutralColor,
  primaryColor,
  currentResponseLanguage,
  currentTimezone,
  responseLanguage,
  telemetry,
  timezone,
  transitionMode,
  workflowStreamingExpandLevel,
};

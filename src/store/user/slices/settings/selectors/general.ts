import { isDesktop } from '@lobechat/const';

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
  telemetry,
  transitionMode,
};

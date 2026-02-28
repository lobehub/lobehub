import Billing from '@/business/client/BusinessSettingPages/Billing';
import Funds from '@/business/client/BusinessSettingPages/Funds';
import Plans from '@/business/client/BusinessSettingPages/Plans';
import Referral from '@/business/client/BusinessSettingPages/Referral';
import Usage from '@/business/client/BusinessSettingPages/Usage';
import { SettingsTabs } from '@/store/global/initialState';

import About from '../about';
import Agent from '../agent';
import APIKey from '../apikey';
import ChatAppearance from '../chat-appearance';
import Common from '../common';
import Hotkey from '../hotkey';
import Image from '../image';
import Memory from '../memory';
import Profile from '../profile';
import Provider from '../provider';
import Proxy from '../proxy';
import Security from '../security';
import Skill from '../skill';
import Stats from '../stats';
import Storage from '../storage';
import SystemTools from '../system-tools';
import TTS from '../tts';

export const componentMap = {
  [SettingsTabs.Common]: Common,
  [SettingsTabs.ChatAppearance]: ChatAppearance,
  [SettingsTabs.Provider]: Provider,
  [SettingsTabs.Image]: Image,
  [SettingsTabs.Memory]: Memory,
  [SettingsTabs.TTS]: TTS,
  [SettingsTabs.About]: About,
  [SettingsTabs.Hotkey]: Hotkey,
  [SettingsTabs.Proxy]: Proxy,
  [SettingsTabs.SystemTools]: SystemTools,
  [SettingsTabs.Storage]: Storage,
  [SettingsTabs.Agent]: Agent,
  // Profile related tabs
  [SettingsTabs.Profile]: Profile,
  [SettingsTabs.Stats]: Stats,
  [SettingsTabs.APIKey]: APIKey,
  [SettingsTabs.Security]: Security,
  [SettingsTabs.Skill]: Skill,

  [SettingsTabs.Plans]: Plans,
  [SettingsTabs.Funds]: Funds,
  [SettingsTabs.Usage]: Usage,
  [SettingsTabs.Billing]: Billing,
  [SettingsTabs.Referral]: Referral,
};

import Billing from '@/business/client/BusinessSettingPages/Billing';
import Funds from '@/business/client/BusinessSettingPages/Funds';
import Plans from '@/business/client/BusinessSettingPages/Plans';
import Referral from '@/business/client/BusinessSettingPages/Referral';
import Usage from '@/business/client/BusinessSettingPages/Usage';
import { SettingsTabs } from '@/store/global/initialState';

import About from '../about';
import Advanced from '../advanced';
import Appearance from '../appearance';
import APIKey from '../apikey';
import Beta from '../beta';
import Hotkey from '../hotkey';
import Memory from '../memory';
import Profile from '../profile';
import Provider from '../provider';
import Proxy from '../proxy';
import Security from '../security';
import ServiceModel from '../service-model';
import Skill from '../skill';
import Storage from '../storage';
import SystemTools from '../system-tools';

export const componentMap = {
  [SettingsTabs.Advanced]: Advanced,
  [SettingsTabs.Beta]: Beta,
  [SettingsTabs.Appearance]: Appearance,
  [SettingsTabs.Provider]: Provider,
  [SettingsTabs.ServiceModel]: ServiceModel,
  [SettingsTabs.Memory]: Memory,
  [SettingsTabs.About]: About,
  [SettingsTabs.Hotkey]: Hotkey,
  [SettingsTabs.Proxy]: Proxy,
  [SettingsTabs.SystemTools]: SystemTools,
  [SettingsTabs.Storage]: Storage,
  // Profile related tabs
  [SettingsTabs.Profile]: Profile,
  [SettingsTabs.Usage]: Usage,
  [SettingsTabs.APIKey]: APIKey,
  [SettingsTabs.Security]: Security,
  [SettingsTabs.Skill]: Skill,

  [SettingsTabs.Plans]: Plans,
  [SettingsTabs.Funds]: Funds,
  [SettingsTabs.Billing]: Billing,
  [SettingsTabs.Referral]: Referral,
};

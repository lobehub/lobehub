import { SettingsTabs } from '@/store/global/initialState';

import AboutSkeleton from './About';
import AdvancedSkeleton from './Advanced';
import APIKeySkeleton from './APIKey';
import AppearanceSkeleton from './Appearance';
import BillingSkeleton from './Billing';
import ConnectorSkeleton from './Connector';
import CreditsSkeleton from './Credits';
import CredsSkeleton from './Creds';
import DevicesSkeleton from './Devices';
import EnvironmentsSkeleton from './Environments';
import HotkeySkeleton from './Hotkey';
import IntegrationsSkeleton from './Integrations';
import LabelsSkeleton from './Labels';
import LabsSkeleton from './Labs';
import MemorySkeleton from './Memory';
import MessengerSkeleton from './Messenger';
import NotificationSkeleton from './Notification';
import OAuthAppsSkeleton from './OAuthApps';
import PlansSkeleton from './Plans';
import ProfileSkeleton from './Profile';
import ProxySkeleton from './Proxy';
import ReferralSkeleton from './Referral';
import SecuritySkeleton from './Security';
import ServiceModelSkeleton from './ServiceModel';
import SkillSkeleton from './Skill';
import StatsSkeleton from './Stats';
import StorageSkeleton from './Storage';
import SystemToolsSkeleton from './SystemTools';
import ToolsSkeleton from './Tools';
import TrashSkeleton from './Trash';
import type { SettingsTabSkeleton } from './types';
import UsageSkeleton from './Usage';

export type { SettingsTabSkeleton, SettingsTabSkeletonProps } from './types';

/** One loading shape per settings tab; tabs without an entry use the generic form. */
export const SETTINGS_TAB_SKELETONS: Partial<Record<SettingsTabs, SettingsTabSkeleton>> = {
  [SettingsTabs.About]: AboutSkeleton,
  [SettingsTabs.Advanced]: AdvancedSkeleton,
  [SettingsTabs.APIKey]: APIKeySkeleton,
  [SettingsTabs.Appearance]: AppearanceSkeleton,
  [SettingsTabs.Billing]: BillingSkeleton,
  [SettingsTabs.Connector]: ConnectorSkeleton,
  [SettingsTabs.Credits]: CreditsSkeleton,
  [SettingsTabs.Creds]: CredsSkeleton,
  [SettingsTabs.Devices]: DevicesSkeleton,
  [SettingsTabs.Environments]: EnvironmentsSkeleton,
  [SettingsTabs.Hotkey]: HotkeySkeleton,
  [SettingsTabs.Integrations]: IntegrationsSkeleton,
  [SettingsTabs.Labels]: LabelsSkeleton,
  [SettingsTabs.Labs]: LabsSkeleton,
  [SettingsTabs.Memory]: MemorySkeleton,
  [SettingsTabs.Messenger]: MessengerSkeleton,
  [SettingsTabs.Notification]: NotificationSkeleton,
  [SettingsTabs.OAuthApps]: OAuthAppsSkeleton,
  [SettingsTabs.Plans]: PlansSkeleton,
  [SettingsTabs.Profile]: ProfileSkeleton,
  [SettingsTabs.Proxy]: ProxySkeleton,
  [SettingsTabs.Referral]: ReferralSkeleton,
  [SettingsTabs.Security]: SecuritySkeleton,
  [SettingsTabs.ServiceModel]: ServiceModelSkeleton,
  [SettingsTabs.Skill]: SkillSkeleton,
  [SettingsTabs.Stats]: StatsSkeleton,
  [SettingsTabs.Storage]: StorageSkeleton,
  [SettingsTabs.SystemTools]: SystemToolsSkeleton,
  [SettingsTabs.Tools]: ToolsSkeleton,
  [SettingsTabs.Trash]: TrashSkeleton,
  [SettingsTabs.Usage]: UsageSkeleton,
};

export const getSettingsTabSkeleton = (tab: string): SettingsTabSkeleton | undefined =>
  Object.hasOwn(SETTINGS_TAB_SKELETONS, tab)
    ? SETTINGS_TAB_SKELETONS[tab as SettingsTabs]
    : undefined;

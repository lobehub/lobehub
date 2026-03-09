import { createElement } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import dynamic from '@/libs/next/dynamic';
import { SettingsTabs } from '@/store/global/initialState';

const loading = (debugId: string) => () => createElement(Loading, { debugId });

export const componentMap = {
  [SettingsTabs.Advanced]: dynamic(() => import('../advanced'), {
    loading: loading('Settings > Advanced'),
  }),
  [SettingsTabs.Appearance]: dynamic(() => import('../appearance'), {
    loading: loading('Settings > Appearance'),
  }),
  [SettingsTabs.Provider]: dynamic(() => import('../provider'), {
    loading: loading('Settings > Provider'),
  }),
  [SettingsTabs.ServiceModel]: dynamic(() => import('../service-model'), {
    loading: loading('Settings > ServiceModel'),
  }),
  [SettingsTabs.Memory]: dynamic(() => import('../memory'), {
    loading: loading('Settings > Memory'),
  }),
  [SettingsTabs.About]: dynamic(() => import('../about'), {
    loading: loading('Settings > About'),
  }),
  [SettingsTabs.Hotkey]: dynamic(() => import('../hotkey'), {
    loading: loading('Settings > Hotkey'),
  }),
  [SettingsTabs.Proxy]: dynamic(() => import('../proxy'), {
    loading: loading('Settings > Proxy'),
  }),
  [SettingsTabs.SystemTools]: dynamic(() => import('../system-tools'), {
    loading: loading('Settings > SystemTools'),
  }),
  [SettingsTabs.Storage]: dynamic(() => import('../storage'), {
    loading: loading('Settings > Storage'),
  }),
  // Profile related tabs
  [SettingsTabs.Profile]: dynamic(() => import('../profile'), {
    loading: loading('Settings > Profile'),
  }),
  [SettingsTabs.Usage]: dynamic(() => import('../stats'), {
    loading: loading('Settings > Usage'),
  }),
  [SettingsTabs.APIKey]: dynamic(() => import('../apikey'), {
    loading: loading('Settings > APIKey'),
  }),
  [SettingsTabs.Security]: dynamic(() => import('../security'), {
    loading: loading('Settings > Security'),
  }),
  [SettingsTabs.Skill]: dynamic(() => import('../skill'), {
    loading: loading('Settings > Skill'),
  }),

  [SettingsTabs.Plans]: dynamic(() => import('@/business/client/BusinessSettingPages/Plans'), {
    loading: loading('Settings > Plans'),
  }),
  [SettingsTabs.Funds]: dynamic(() => import('@/business/client/BusinessSettingPages/Funds'), {
    loading: loading('Settings > Funds'),
  }),
  [SettingsTabs.Billing]: dynamic(() => import('@/business/client/BusinessSettingPages/Billing'), {
    loading: loading('Settings > Billing'),
  }),
  [SettingsTabs.Referral]: dynamic(
    () => import('@/business/client/BusinessSettingPages/Referral'),
    {
      loading: loading('Settings > Referral'),
    },
  ),
};

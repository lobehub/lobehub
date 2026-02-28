import { createElement } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import dynamic from '@/libs/next/dynamic';
import { SettingsTabs } from '@/store/global/initialState';

const loading = (debugId: string) => () => createElement(Loading, { debugId });

export const componentMap = {
  [SettingsTabs.Common]: dynamic(() => import('../common'), {
    loading: loading('Settings > Common'),
  }),
  [SettingsTabs.ChatAppearance]: dynamic(() => import('../chat-appearance'), {
    loading: loading('Settings > ChatAppearance'),
  }),
  [SettingsTabs.Provider]: dynamic(() => import('../provider'), {
    loading: loading('Settings > Provider'),
  }),
  [SettingsTabs.Image]: dynamic(() => import('../image'), {
    loading: loading('Settings > Image'),
  }),
  [SettingsTabs.Memory]: dynamic(() => import('../memory'), {
    loading: loading('Settings > Memory'),
  }),
  [SettingsTabs.TTS]: dynamic(() => import('../tts'), {
    loading: loading('Settings > TTS'),
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
  [SettingsTabs.Agent]: dynamic(() => import('../agent'), {
    loading: loading('Settings > Agent'),
  }),
  // Profile related tabs
  [SettingsTabs.Profile]: dynamic(() => import('../profile'), {
    loading: loading('Settings > Profile'),
  }),
  [SettingsTabs.Stats]: dynamic(() => import('../stats'), {
    loading: loading('Settings > Stats'),
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
  [SettingsTabs.Usage]: dynamic(() => import('@/business/client/BusinessSettingPages/Usage'), {
    loading: loading('Settings > Usage'),
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

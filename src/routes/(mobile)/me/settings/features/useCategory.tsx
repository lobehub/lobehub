import { Brain, BrainCircuit, Info, Settings2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { type CellProps } from '@/components/Cell';
import { SettingsTabs } from '@/store/global/initialState';

export const useCategory = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('setting');

  const items: CellProps[] = [
    {
      icon: Settings2,
      key: SettingsTabs.Appearance,
      label: t('tab.appearance'),
    },
    {
      icon: Brain,
      key: SettingsTabs.Provider,
      label: t('tab.provider'),
    },
    {
      icon: Sparkles,
      key: SettingsTabs.ServiceModel,
      label: t('tab.serviceModel'),
    },
    {
      icon: BrainCircuit,
      key: SettingsTabs.Memory,
      label: t('tab.memory'),
    },
    {
      icon: Info,
      key: SettingsTabs.About,
      label: t('tab.about'),
    },
  ].filter(Boolean) as CellProps[];

  return items.map((item) => ({
    ...item,
    onClick: () => {
      if (item.key === SettingsTabs.Provider) {
        navigate('/settings/provider/all');
      } else {
        navigate(`/settings/${item.key}`);
      }
    },
  }));
};

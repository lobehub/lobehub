import { createModal, Tabs, type TabsItem } from '@lobehub/ui/base-ui';
import { t as i18nT } from 'i18next';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useMergeState from 'use-merge-value';

import PluginSettingsConfig from '@/features/PluginSettings';
import { pluginHelpers } from '@/store/tool';

import APIs from './APIs';
import Meta from './Meta';

export interface PluginDetailModalProps {
  id: string;
  onTabChange?: (key: string) => void;
  schema: any;
  tab?: string;
}

enum Tab {
  Info = 'info',
  Settings = 'settings',
}

const PluginDetailModal = memo<PluginDetailModalProps>(({ schema, id, onTabChange, tab }) => {
  const [tabKey, setTabKey] = useMergeState(Tab.Info, {
    onChange: onTabChange,
    value: tab,
  });
  const { t } = useTranslation('plugin');

  const hasSettings = pluginHelpers.isSettingSchemaNonEmpty(schema);

  return (
    <>
      <Meta id={id} />
      <Tabs
        activeKey={tabKey}
        items={
          [
            {
              key: Tab.Info,
              label: t('detailModal.tabs.info'),
            },
            hasSettings && {
              key: Tab.Settings,
              label: t('detailModal.tabs.settings'),
            },
          ].filter(Boolean) as TabsItem[]
        }
        style={{
          marginBlock: 16,
        }}
        styles={{
          list: { display: 'flex', width: '100%' },
          tab: { flex: 1 },
        }}
        onChange={(key) => setTabKey(key as Tab)}
      />
      {tabKey === 'settings' ? (
        hasSettings && <PluginSettingsConfig id={id} schema={schema} />
      ) : (
        <APIs id={id} />
      )}
    </>
  );
});

PluginDetailModal.displayName = 'PluginDetailModal';

export const createPluginDetailModal = (props: PluginDetailModalProps) =>
  createModal({
    content: <PluginDetailModal {...props} />,
    footer: null,
    title: i18nT('dev.title.skillDetails', { ns: 'plugin' }),
    width: 800,
  });

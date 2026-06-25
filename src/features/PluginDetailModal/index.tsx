import { Modal } from '@lobehub/ui';
import { Tabs, type TabsItem } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useMergeState from 'use-merge-value';

import PluginSettingsConfig from '@/features/PluginSettings';
import { pluginHelpers } from '@/store/tool';

import APIs from './APIs';
import Meta from './Meta';

export interface PluginDetailModalProps {
  id: string;
  onClose: () => void;
  onTabChange?: (key: string) => void;
  open: boolean;
  schema: any;
  tab?: string;
}

enum Tab {
  Info = 'info',
  Settings = 'settings',
}

const PluginDetailModal = memo<PluginDetailModalProps>(
  ({ schema, onClose, id, onTabChange, open, tab }) => {
    const [tabKey, setTabKey] = useMergeState(Tab.Info, {
      onChange: onTabChange,
      value: tab,
    });
    const { t } = useTranslation('plugin');

    const hasSettings = pluginHelpers.isSettingSchemaNonEmpty(schema);

    return (
      <Modal
        allowFullscreen
        destroyOnHidden
        footer={null}
        open={open}
        title={t('dev.title.skillDetails')}
        width={800}
        onCancel={onClose}
        onOk={() => {
          onClose();
        }}
      >
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
      </Modal>
    );
  },
);

export default PluginDetailModal;

import { Modal, Segmented, type SegmentedProps } from '@lobehub/ui';
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
        onCancel={onClose}
        onOk={() => {
          onClose();
        }}
        open={open}
        title={t('dev.title.skillDetails')}
        width={800}
      >
        <Meta id={id} />
        <Segmented
          block
          onChange={(v) => setTabKey(v as Tab)}
          options={
            [
              {
                label: t('detailModal.tabs.info'),
                value: Tab.Info,
              },
              hasSettings && {
                label: t('detailModal.tabs.settings'),
                value: Tab.Settings,
              },
            ].filter(Boolean) as SegmentedProps['options']
          }
          style={{
            marginBlock: 16,
          }}
          value={tabKey}
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

import { Flexbox, Icon, Segmented } from '@lobehub/ui';
import { Blocks, ChevronRight, Store } from 'lucide-react';
import { Suspense, memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginStore from '@/features/PluginStore';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { useAgentId } from '../../hooks/useAgentId';
import Action from '../components/Action';
import ToolsList, { toolsListStyles } from './ToolsList';
import { useControls } from './useControls';

type TabType = 'all' | 'installed';

const Tools = memo(() => {
  const { t } = useTranslation('setting');
  const [modalOpen, setModalOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType | null>(null);
  const { marketItems, installedPluginItems } = useControls({
    setUpdating,
  });

  const enableKlavis = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const isInitializedRef = useRef(false);

  // Set default tab based on installed plugins (only on first load)
  useEffect(() => {
    if (!isInitializedRef.current && installedPluginItems.length >= 0) {
      isInitializedRef.current = true;
      setActiveTab(installedPluginItems.length > 0 ? 'installed' : 'all');
    }
  }, [installedPluginItems.length]);

  const agentId = useAgentId();
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(agentId)(s));
  const provider = useAgentStore((s) => agentByIdSelectors.getAgentModelProviderById(agentId)(s));

  const enableFC = useModelSupportToolUse(model, provider);

  if (!enableFC)
    return <Action disabled icon={Blocks} showTooltip={true} title={t('tools.disabled')} />;

  // Use effective tab for display (default to market while initializing)
  const effectiveTab = activeTab ?? 'all';
  const currentItems = effectiveTab === 'all' ? marketItems : installedPluginItems;

  const popoverContent = (
    <Flexbox gap={0}>
      <div style={{ borderBottom: '1px solid var(--ant-color-border-secondary)', padding: 8 }}>
        <Segmented
          block
          onChange={(v) => setActiveTab(v as TabType)}
          options={[
            {
              label: t('tools.tabs.all', { defaultValue: 'all' }),
              value: 'all',
            },
            {
              label: t('tools.tabs.installed', { defaultValue: 'Installed' }),
              value: 'installed',
            },
          ]}
          size="small"
          value={effectiveTab}
        />
      </div>
      <div
        style={{
          maxHeight: 500,
          minHeight: enableKlavis ? 500 : undefined,
          overflowY: 'auto',
        }}
      >
        <ToolsList items={currentItems} />
      </div>
      <div style={{ borderTop: '1px solid var(--ant-color-border-secondary)', padding: 4 }}>
        <div
          className={toolsListStyles.item}
          onClick={() => setModalOpen(true)}
          role="button"
          tabIndex={0}
        >
          <Icon icon={Store} size={20} />
          <div className={toolsListStyles.itemContent}>{t('tools.plugins.store')}</div>
          <Icon icon={ChevronRight} size={16} style={{ opacity: 0.5 }} />
        </div>
      </div>
    </Flexbox>
  );

  return (
    <Suspense fallback={<Action disabled icon={Blocks} title={t('tools.title')} />}>
      <Action
        icon={Blocks}
        loading={updating}
        popover={{
          content: popoverContent,
          maxWidth: 320,
          minWidth: 320,
          styles: {
            content: {
              padding: 0,
            },
          },
        }}
        showTooltip={false}
        title={t('tools.title')}
      />
      <PluginStore open={modalOpen} setOpen={setModalOpen} />
    </Suspense>
  );
});

export default Tools;

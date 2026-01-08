import { Blocks } from 'lucide-react';
import { Suspense, memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PluginStore from '@/features/PluginStore';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { useAgentId } from '../../hooks/useAgentId';
import Action from '../components/Action';
import PopoverContent from './PopoverContent';
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

  return (
    <Suspense fallback={<Action disabled icon={Blocks} title={t('tools.title')} />}>
      <Action
        icon={Blocks}
        loading={updating}
        popover={{
          content: (
            <PopoverContent
              activeTab={effectiveTab}
              currentItems={currentItems}
              enableKlavis={enableKlavis}
              onOpenStore={() => setModalOpen(true)}
              onTabChange={setActiveTab}
            />
          ),
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

import { Segmented } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
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
import { useControls } from './useControls';

type TabType = 'all' | 'installed';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  dropdown: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};

    .${prefixCls}-dropdown-menu {
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
  `,
  header: css`
    padding: ${cssVar.paddingXS};
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: transparent;
  `,
  scroller: css`
    overflow: hidden auto;
  `,
}));

const Tools = memo(() => {
  const { t } = useTranslation('setting');
  const [modalOpen, setModalOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType | null>(null);
  const { marketItems, installedPluginItems } = useControls({
    setModalOpen,
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
        dropdown={{
          maxWidth: 320,
          menu: {
            items: [...currentItems],
            style: {
              // let only the custom scroller scroll
              maxHeight: 'unset',
              overflowY: 'visible',
            },
          },
          minHeight: enableKlavis ? 500 : undefined,
          minWidth: 320,
          popupRender: (menu) => (
            <div className={styles.dropdown}>
              <div className={styles.header}>
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
                className={styles.scroller}
                style={{
                  maxHeight: 500,
                  minHeight: enableKlavis ? 500 : undefined,
                }}
              >
                {menu}
              </div>
            </div>
          ),
        }}
        icon={Blocks}
        loading={updating}
        showTooltip={false}
        title={t('tools.title')}
      />
      <PluginStore open={modalOpen} setOpen={setModalOpen} />
    </Suspense>
  );
});

export default Tools;

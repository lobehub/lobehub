import { TooltipGroup } from '@lobehub/ui';
import { Dropdown } from 'antd';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Rnd } from 'react-rnd';

import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { Footer } from './Footer';
import { Toolbar } from './Toolbar';
import { VirtualItemRenderer } from './VirtualItemRenderer';
import {
  DEFAULT_WIDTH,
  ENABLE_RESIZING,
  FOOTER_HEIGHT,
  INITIAL_RENDER_COUNT,
  ITEM_HEIGHT,
  MAX_PANEL_HEIGHT,
  MAX_WIDTH,
  MIN_WIDTH,
  RENDER_ALL_DELAY_MS,
  STORAGE_KEY,
  STORAGE_KEY_MODE,
  TOOLBAR_HEIGHT,
} from './constants';
import { useBuildVirtualItems, useCurrentModelName } from './hooks';
import { styles } from './styles';
import type { GroupMode, ModelSwitchPanelProps } from './types';
import { menuKey } from './utils';

const ModelSwitchPanel = memo<ModelSwitchPanelProps>(
  ({
    children,
    model: modelProp,
    onModelChange,
    onOpenChange,
    open,
    placement = 'topLeft',
    provider: providerProp,
  }) => {
    const { t: tCommon } = useTranslation('common');
    const newLabel = tCommon('new');

    const [panelWidth, setPanelWidth] = useState(() => {
      if (typeof window === 'undefined') return DEFAULT_WIDTH;
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? Number(stored) : DEFAULT_WIDTH;
    });

    const [groupMode, setGroupMode] = useState<GroupMode>(() => {
      if (typeof window === 'undefined') return 'byModel';
      const stored = localStorage.getItem(STORAGE_KEY_MODE);
      return (stored as GroupMode) || 'byModel';
    });

    const [renderAll, setRenderAll] = useState(false);
    const [internalOpen, setInternalOpen] = useState(false);

    // Use controlled open if provided, otherwise use internal state
    const isOpen = open ?? internalOpen;

    // Only delay render all items on first open, then keep cached
    useEffect(() => {
      if (isOpen && !renderAll) {
        const timer = setTimeout(() => {
          setRenderAll(true);
        }, RENDER_ALL_DELAY_MS);
        return () => clearTimeout(timer);
      }
    }, [isOpen, renderAll]);

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
      },
      [onOpenChange],
    );

    // Get values from store for fallback when props are not provided
    const [storeModel, storeProvider, updateAgentConfig] = useAgentStore((s) => [
      agentSelectors.currentAgentModel(s),
      agentSelectors.currentAgentModelProvider(s),
      s.updateAgentConfig,
    ]);

    // Use props if provided, otherwise fallback to store values
    const model = modelProp ?? storeModel;
    const provider = providerProp ?? storeProvider;

    const enabledList = useEnabledChatModels();

    const handleModelChange = useCallback(
      async (modelId: string, providerId: string) => {
        const params = { model: modelId, provider: providerId };
        if (onModelChange) {
          await onModelChange(params);
        } else {
          await updateAgentConfig(params);
        }
      },
      [onModelChange, updateAgentConfig],
    );

    const handleClose = useCallback(() => {
      handleOpenChange(false);
    }, [handleOpenChange]);

    const handleGroupModeChange = useCallback((mode: GroupMode) => {
      setGroupMode(mode);
      localStorage.setItem(STORAGE_KEY_MODE, mode);
    }, []);

    // Build virtual items based on group mode
    const virtualItems = useBuildVirtualItems(enabledList, groupMode);

    // Use a fixed panel height to prevent shifting when switching modes
    const panelHeight =
      enabledList.length === 0
        ? TOOLBAR_HEIGHT + ITEM_HEIGHT['no-provider'] + FOOTER_HEIGHT
        : MAX_PANEL_HEIGHT;

    const activeKey = menuKey(provider, model);

    // Find current model's display name
    const currentModelName = useCurrentModelName(enabledList, model);

    return (
      <TooltipGroup>
        <Dropdown
          arrow={false}
          onOpenChange={handleOpenChange}
          open={isOpen}
          placement={placement}
          popupRender={() => (
            <Rnd
              className={styles.dropdown}
              disableDragging
              enableResizing={ENABLE_RESIZING}
              maxWidth={MAX_WIDTH}
              minWidth={MIN_WIDTH}
              onResizeStop={(_e, _direction, ref) => {
                const newWidth = ref.offsetWidth;
                setPanelWidth(newWidth);
                localStorage.setItem(STORAGE_KEY, String(newWidth));
              }}
              position={{ x: 0, y: 0 }}
              size={{ height: panelHeight, width: panelWidth }}
              style={{ position: 'relative' }}
            >
              <Toolbar
                currentModelName={currentModelName}
                groupMode={groupMode}
                onGroupModeChange={handleGroupModeChange}
              />
              <div
                style={{
                  height: panelHeight - TOOLBAR_HEIGHT - FOOTER_HEIGHT,
                  overflow: 'auto',
                  paddingBlock: groupMode === 'byModel' ? 8 : 0,
                  width: '100%',
                }}
              >
                {(renderAll ? virtualItems : virtualItems.slice(0, INITIAL_RENDER_COUNT)).map(
                  (item) => (
                    <VirtualItemRenderer
                      activeKey={activeKey}
                      item={item}
                      key={
                        item.type === 'model-item'
                          ? item.data.displayName
                          : item.type === 'provider-model-item'
                            ? menuKey(item.provider.id, item.model.id)
                            : item.type === 'group-header'
                              ? `header-${item.provider.id}`
                              : item.type === 'empty-model'
                                ? `empty-${item.provider.id}`
                                : 'no-provider'
                      }
                      newLabel={newLabel}
                      onClose={handleClose}
                      onModelChange={handleModelChange}
                    />
                  ),
                )}
              </div>
              <Footer onClose={handleClose} />
            </Rnd>
          )}
        >
          <div className={styles.tag}>{children}</div>
        </Dropdown>
      </TooltipGroup>
    );
  },
);

ModelSwitchPanel.displayName = 'ModelSwitchPanel';

export default ModelSwitchPanel;


export {type ModelSwitchPanelProps} from './types';
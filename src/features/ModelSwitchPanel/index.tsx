import { ActionIcon, Flexbox, Icon, TooltipGroup } from '@lobehub/ui';
import { Dropdown } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { LucideArrowRight, LucideBolt } from 'lucide-react';
import { type AiModelForSelect } from 'model-bank';
import { type ReactNode, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Rnd } from 'react-rnd';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';
import { useEnabledChatModels } from '@/hooks/useEnabledChatModels';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { type EnabledProviderWithModels } from '@/types/aiProvider';

const STORAGE_KEY = 'MODEL_SWITCH_PANEL_WIDTH';
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const MAX_PANEL_HEIGHT = 550;

const INITIAL_RENDER_COUNT = 15;
const RENDER_ALL_DELAY_MS = 500;

const ITEM_HEIGHT = {
  'empty-model': 38,
  'group-header': 40,
  'model-item': 38,
  'no-provider': 38,
} as const;

const ENABLE_RESIZING = {
  bottom: false,
  bottomLeft: false,
  bottomRight: false,
  left: false,
  right: true,
  top: false,
  topLeft: false,
  topRight: false,
} as const;

const styles = createStaticStyles(({ css, cssVar }) => ({
  dropdown: css`
    overflow: hidden;

    width: 100%;
    height: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  groupHeader: css`
    padding-block: 8px;
    padding-inline: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  menuItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    box-sizing: border-box;
    padding-block: 8px;
    padding-inline: 12px;

    white-space: nowrap;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  menuItemActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  tag: css`
    cursor: pointer;
  `,
}));

const menuKey = (provider: string, model: string) => `${provider}-${model}`;

type VirtualItem =
  | {
      provider: EnabledProviderWithModels;
      type: 'group-header';
    }
  | {
      model: AiModelForSelect;
      provider: EnabledProviderWithModels;
      type: 'model-item';
    }
  | {
      provider: EnabledProviderWithModels;
      type: 'empty-model';
    }
  | {
      type: 'no-provider';
    };

type DropdownPlacement = 'bottom' | 'bottomLeft' | 'bottomRight' | 'top' | 'topLeft' | 'topRight';

interface ModelSwitchPanelProps {
  children?: ReactNode;
  /**
   * Current model ID. If not provided, uses currentAgentModel from store.
   */
  model?: string;
  /**
   * Callback when model changes. If not provided, uses updateAgentConfig from store.
   */
  onModelChange?: (params: { model: string; provider: string }) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  /**
   * Dropdown placement. Defaults to 'topLeft'.
   */
  placement?: DropdownPlacement;
  /**
   * Current provider ID. If not provided, uses currentAgentModelProvider from store.
   */
  provider?: string;
}

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
    const { t } = useTranslation('components');
    const { t: tCommon } = useTranslation('common');
    const newLabel = tCommon('new');

    const [panelWidth, setPanelWidth] = useState(() => {
      if (typeof window === 'undefined') return DEFAULT_WIDTH;
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? Number(stored) : DEFAULT_WIDTH;
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

    const navigate = useNavigate();
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

    // Flatten the provider/model tree into a flat list for virtual scrolling
    const { virtualItems, panelHeight } = useMemo(() => {
      if (enabledList.length === 0) {
        return {
          panelHeight: ITEM_HEIGHT['no-provider'],
          virtualItems: [{ type: 'no-provider' }] as VirtualItem[],
        };
      }

      const items: VirtualItem[] = [];
      let totalHeight = 0;

      for (const providerItem of enabledList) {
        // Add provider group header
        items.push({ provider: providerItem, type: 'group-header' });
        totalHeight += ITEM_HEIGHT['group-header'];

        if (providerItem.children.length === 0) {
          // Add empty model placeholder
          items.push({ provider: providerItem, type: 'empty-model' });
          totalHeight += ITEM_HEIGHT['empty-model'];
        } else {
          // Add each model item
          for (const modelItem of providerItem.children) {
            items.push({ model: modelItem, provider: providerItem, type: 'model-item' });
            totalHeight += ITEM_HEIGHT['model-item'];
          }
        }
      }

      return {
        panelHeight: Math.min(totalHeight, MAX_PANEL_HEIGHT),
        virtualItems: items,
      };
    }, [enabledList]);

    const activeKey = menuKey(provider, model);

    const renderVirtualItem = useCallback(
      (item: VirtualItem) => {
        switch (item.type) {
          case 'no-provider': {
            return (
              <div
                className={styles.menuItem}
                key="no-provider"
                onClick={() => navigate('/settings/provider/all')}
              >
                <Flexbox gap={8} horizontal style={{ color: cssVar.colorTextTertiary }}>
                  {t('ModelSwitchPanel.emptyProvider')}
                  <Icon icon={LucideArrowRight} />
                </Flexbox>
              </div>
            );
          }

          case 'group-header': {
            return (
              <div className={styles.groupHeader} key={`header-${item.provider.id}`}>
                <Flexbox horizontal justify="space-between">
                  <ProviderItemRender
                    logo={item.provider.logo}
                    name={item.provider.name}
                    provider={item.provider.id}
                    source={item.provider.source}
                  />
                  <ActionIcon
                    icon={LucideBolt}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const url = urlJoin('/settings/provider', item.provider.id || 'all');
                      if (e.ctrlKey || e.metaKey) {
                        window.open(url, '_blank');
                      } else {
                        navigate(url);
                      }
                    }}
                    size={'small'}
                    title={t('ModelSwitchPanel.goToSettings')}
                  />
                </Flexbox>
              </div>
            );
          }

          case 'empty-model': {
            return (
              <div
                className={styles.menuItem}
                key={`empty-${item.provider.id}`}
                onClick={() => navigate(`/settings/provider/${item.provider.id}`)}
              >
                <Flexbox gap={8} horizontal style={{ color: cssVar.colorTextTertiary }}>
                  {t('ModelSwitchPanel.emptyModel')}
                  <Icon icon={LucideArrowRight} />
                </Flexbox>
              </div>
            );
          }

          case 'model-item': {
            const key = menuKey(item.provider.id, item.model.id);
            const isActive = key === activeKey;

            return (
              <div
                className={cx(styles.menuItem, isActive && styles.menuItemActive)}
                key={key}
                onClick={async () => {
                  await handleModelChange(item.model.id, item.provider.id);
                  handleOpenChange(false);
                }}
              >
                <ModelItemRender
                  {...item.model}
                  {...item.model.abilities}
                  infoTagTooltipOnHover
                  newBadgeLabel={newLabel}
                  showInfoTag
                />
              </div>
            );
          }

          default: {
            return null;
          }
        }
      },
      [activeKey, cx, handleModelChange, handleOpenChange, navigate, newLabel, styles, t],
    );

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
              <div style={{ height: panelHeight, overflow: 'auto', width: '100%' }}>
                {(renderAll ? virtualItems : virtualItems.slice(0, INITIAL_RENDER_COUNT)).map(
                  renderVirtualItem,
                )}
              </div>
            </Rnd>
          )}
        >
          <div className={styles.tag}>{children}</div>
        </Dropdown>
      </TooltipGroup>
    );
  },
);

export default ModelSwitchPanel;
export type { ModelSwitchPanelProps };

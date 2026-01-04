import { ActionIcon, Flexbox, Icon, Segmented, TooltipGroup } from '@lobehub/ui';
import { ProviderIcon } from '@lobehub/ui/icons';
import { Dropdown } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import {
  Brain,
  LucideArrowRight,
  LucideBolt,
  LucideCheck,
  LucideChevronRight,
  LucideSettings,
} from 'lucide-react';
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
const STORAGE_KEY_MODE = 'MODEL_SWITCH_PANEL_MODE';
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 600;
const MAX_PANEL_HEIGHT = 460;
const TOOLBAR_HEIGHT = 40;
const FOOTER_HEIGHT = 48;

const INITIAL_RENDER_COUNT = 15;
const RENDER_ALL_DELAY_MS = 500;

const ITEM_HEIGHT = {
  'empty-model': 32,
  'group-header': 32,
  'model-item': 32,
  'no-provider': 32,
} as const;

type GroupMode = 'byModel' | 'byProvider';

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
  footer: css`
    position: sticky;
    z-index: 10;
    inset-block-end: 0;

    padding-block: 6px;
    padding-inline: 0;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgElevated};
  `,
  footerButton: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    box-sizing: border-box;
    margin-inline: 8px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextSecondary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  groupHeader: css`
    margin-inline: 8px;
    padding-block: 6px;
    padding-inline: 8px;
    color: ${cssVar.colorTextSecondary};
  `,
  menuItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    box-sizing: border-box;
    margin-inline: 8px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    white-space: nowrap;

    &:hover {
      background: ${cssVar.colorFillTertiary};

      .settings-icon {
        opacity: 1;
      }
    }
  `,
  menuItemActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  settingsIcon: css`
    opacity: 0;
  `,
  submenu: css`
    .ant-dropdown-menu {
      padding: 4px;
    }

    .ant-dropdown-menu-item {
      margin-inline: 0;
      padding-block: 6px;
      padding-inline: 8px;
      border-radius: ${cssVar.borderRadiusSM};
    }

    .ant-dropdown-menu-item-group-title {
      padding-block: 6px;
      padding-inline: 8px;
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
    }
  `,
  tag: css`
    cursor: pointer;
  `,
  toolbar: css`
    position: sticky;
    z-index: 10;
    inset-block-start: 0;

    display: flex;
    align-items: center;
    justify-content: flex-end;

    padding-block: 6px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgElevated};
  `,
}));

const menuKey = (provider: string, model: string) => `${provider}-${model}`;

interface ModelWithProviders {
  displayName: string;
  model: AiModelForSelect;
  providers: Array<{
    id: string;
    logo?: string;
    name: string;
    source?: EnabledProviderWithModels['source'];
  }>;
}

type VirtualItem =
  | {
      data: ModelWithProviders;
      type: 'model-item';
    }
  | {
      provider: EnabledProviderWithModels;
      type: 'group-header';
    }
  | {
      model: AiModelForSelect;
      provider: EnabledProviderWithModels;
      type: 'provider-model-item';
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

    // Build virtual items based on group mode
    const virtualItems = useMemo(() => {
      if (enabledList.length === 0) {
        return [{ type: 'no-provider' }] as VirtualItem[];
      }

      if (groupMode === 'byModel') {
        // Group models by display name
        const modelMap = new Map<string, ModelWithProviders>();

        for (const providerItem of enabledList) {
          for (const modelItem of providerItem.children) {
            const displayName = modelItem.displayName || modelItem.id;

            if (!modelMap.has(displayName)) {
              modelMap.set(displayName, {
                displayName,
                model: modelItem,
                providers: [],
              });
            }

            const entry = modelMap.get(displayName)!;
            entry.providers.push({
              id: providerItem.id,
              logo: providerItem.logo,
              name: providerItem.name,
              source: providerItem.source,
            });
          }
        }

        // Convert to array and sort by display name
        return Array.from(modelMap.values())
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map((data) => ({ data, type: 'model-item' as const }));
      } else {
        // Group by provider (original structure)
        const items: VirtualItem[] = [];

        for (const providerItem of enabledList) {
          // Add provider group header
          items.push({ provider: providerItem, type: 'group-header' });

          if (providerItem.children.length === 0) {
            // Add empty model placeholder
            items.push({ provider: providerItem, type: 'empty-model' });
          } else {
            // Add each model item
            for (const modelItem of providerItem.children) {
              items.push({
                model: modelItem,
                provider: providerItem,
                type: 'provider-model-item',
              });
            }
          }
        }

        return items;
      }
    }, [enabledList, groupMode]);

    // Use a fixed panel height to prevent shifting when switching modes
    const panelHeight =
      enabledList.length === 0
        ? TOOLBAR_HEIGHT + ITEM_HEIGHT['no-provider'] + FOOTER_HEIGHT
        : MAX_PANEL_HEIGHT;

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

          case 'provider-model-item': {
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
                  infoTagTooltip={false}
                  newBadgeLabel={newLabel}
                  showInfoTag
                />
              </div>
            );
          }

          case 'model-item': {
            const { data } = item;
            const hasSingleProvider = data.providers.length === 1;

            // Check if this model is currently active and find active provider
            const activeProvider = data.providers.find(
              (p) => menuKey(p.id, data.model.id) === activeKey,
            );
            const isActive = !!activeProvider;
            // Use active provider if found, otherwise use first provider for settings link
            const settingsProvider = activeProvider || data.providers[0];

            // Single provider - direct click without submenu
            if (hasSingleProvider) {
              const singleProvider = data.providers[0];
              const key = menuKey(singleProvider.id, data.model.id);

              return (
                <div className={cx(styles.menuItem, isActive && styles.menuItemActive)} key={key}>
                  <Flexbox
                    align={'center'}
                    gap={8}
                    horizontal
                    justify={'space-between'}
                    onClick={async () => {
                      await handleModelChange(data.model.id, singleProvider.id);
                      handleOpenChange(false);
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <ModelItemRender
                      {...data.model}
                      {...data.model.abilities}
                      infoTagTooltip={false}
                      newBadgeLabel={newLabel}
                      showInfoTag={false}
                    />
                  </Flexbox>
                  <div className={cx(styles.settingsIcon, 'settings-icon')}>
                    <ActionIcon
                      icon={LucideBolt}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const url = urlJoin('/settings/provider', settingsProvider.id || 'all');
                        if (e.ctrlKey || e.metaKey) {
                          window.open(url, '_blank');
                        } else {
                          navigate(url);
                        }
                      }}
                      size={'small'}
                      title={t('ModelSwitchPanel.goToSettings')}
                    />
                  </div>
                </div>
              );
            }

            // Multiple providers - show submenu on hover
            return (
              <Dropdown
                align={{ offset: [4, 0] }}
                arrow={false}
                dropdownRender={(menu) => (
                  <div className={styles.submenu} style={{ minWidth: 240 }}>
                    {menu}
                  </div>
                )}
                key={data.displayName}
                menu={{
                  items: [
                    {
                      key: 'header',
                      label: t('ModelSwitchPanel.useModelFrom'),
                      type: 'group',
                    },
                    ...data.providers.map((p) => {
                      const isCurrentProvider = menuKey(p.id, data.model.id) === activeKey;
                      return {
                        key: menuKey(p.id, data.model.id),
                        label: (
                          <Flexbox
                            align={'center'}
                            gap={8}
                            horizontal
                            justify={'space-between'}
                            style={{ minWidth: 0 }}
                          >
                            <Flexbox align={'center'} gap={8} horizontal style={{ minWidth: 0 }}>
                              <div style={{ flexShrink: 0, width: 16 }}>
                                {isCurrentProvider && (
                                  <Icon
                                    icon={LucideCheck}
                                    size={16}
                                    style={{ color: cssVar.colorPrimary }}
                                  />
                                )}
                              </div>
                              <ProviderItemRender
                                logo={p.logo}
                                name={p.name}
                                provider={p.id}
                                source={p.source}
                              />
                            </Flexbox>
                            <ActionIcon
                              icon={LucideBolt}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const url = urlJoin('/settings/provider', p.id || 'all');
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
                        ),
                        onClick: async () => {
                          await handleModelChange(data.model.id, p.id);
                          handleOpenChange(false);
                        },
                      };
                    }),
                  ],
                }}
                // @ts-ignore
                placement="rightTop"
                trigger={['hover']}
              >
                <div className={cx(styles.menuItem, isActive && styles.menuItemActive)}>
                  <Flexbox
                    align={'center'}
                    gap={8}
                    horizontal
                    justify={'space-between'}
                    style={{ width: '100%' }}
                  >
                    <ModelItemRender
                      {...data.model}
                      {...data.model.abilities}
                      infoTagTooltip={false}
                      newBadgeLabel={newLabel}
                      showInfoTag={false}
                    />
                    <Icon
                      icon={LucideChevronRight}
                      size={16}
                      style={{ color: cssVar.colorTextSecondary, flexShrink: 0 }}
                    />
                  </Flexbox>
                </div>
              </Dropdown>
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
              <div className={styles.toolbar}>
                <Segmented
                  onChange={(value) => {
                    const mode = value as GroupMode;
                    setGroupMode(mode);
                    localStorage.setItem(STORAGE_KEY_MODE, mode);
                  }}
                  options={[
                    {
                      icon: <Icon icon={Brain} />,
                      title: t('ModelSwitchPanel.byModel'),
                      value: 'byModel',
                    },
                    {
                      icon: <Icon icon={ProviderIcon} />,
                      title: t('ModelSwitchPanel.byProvider'),
                      value: 'byProvider',
                    },
                  ]}
                  size="small"
                  value={groupMode}
                />
              </div>
              <div
                style={{
                  height: panelHeight - TOOLBAR_HEIGHT - FOOTER_HEIGHT,
                  overflow: 'auto',
                  paddingBlock: groupMode === 'byModel' ? 8 : 0,
                  width: '100%',
                }}
              >
                {(renderAll ? virtualItems : virtualItems.slice(0, INITIAL_RENDER_COUNT)).map(
                  renderVirtualItem,
                )}
              </div>
              <div className={styles.footer}>
                <div
                  className={styles.footerButton}
                  onClick={() => {
                    navigate('/settings/provider/all');
                    handleOpenChange(false);
                  }}
                >
                  <Flexbox align={'center'} gap={8} horizontal style={{ flex: 1 }}>
                    <Icon icon={LucideSettings} size={16} />
                    {t('ModelSwitchPanel.manageProvider')}
                  </Flexbox>
                  <Icon icon={LucideArrowRight} size={16} />
                </div>
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

'use client';

import {
  ActionIcon,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
  Flexbox,
  Icon,
  menuSharedStyles,
} from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { LucideArrowRight, LucideBolt } from 'lucide-react';
import type { ComponentType } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ProviderItemRender } from '@/components/ModelSelect';
import ModelDetailPanel from '@/features/ModelSwitchPanel/components/ModelDetailPanel';
import { styles as modelSwitchPanelStyles } from '@/features/ModelSwitchPanel/styles';
import type { ListItem } from '@/features/ModelSwitchPanel/types';
import { menuKey } from '@/features/ModelSwitchPanel/utils';
import type { EnabledProviderWithModels } from '@/types/index';

import MultipleProvidersItem from './MultipleProvidersItem';

interface ListItemRendererProps {
  activeKey: string;
  enabledList: EnabledProviderWithModels[];
  item: ListItem;
  ModelItemComponent: ComponentType<any>;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => void;
}

const ListItemRenderer = memo<ListItemRendererProps>(
  ({ item, activeKey, onClose, onModelChange, enabledList, ModelItemComponent }) => {
    const { t } = useTranslation('components');
    const navigate = useNavigate();
    const [detailOpen, setDetailOpen] = useState(false);

    switch (item.type) {
      case 'no-provider': {
        return (
          <Flexbox
            horizontal
            className={modelSwitchPanelStyles.menuItem}
            gap={8}
            style={{ color: cssVar.colorTextTertiary }}
            onClick={() => {
              navigate('/settings/provider/all');
              onClose();
            }}
          >
            {t('ModelSwitchPanel.emptyProvider')}
            <Icon icon={LucideArrowRight} />
          </Flexbox>
        );
      }

      case 'group-header': {
        return (
          <Flexbox
            horizontal
            className={modelSwitchPanelStyles.groupHeader}
            justify="space-between"
            paddingBlock="12px 4px"
            paddingInline="12px 8px"
          >
            <ProviderItemRender
              logo={item.provider.logo}
              name={item.provider.name}
              provider={item.provider.id}
              source={item.provider.source}
            />
            <ActionIcon
              className="settings-icon"
              icon={LucideBolt}
              size="small"
              title={t('ModelSwitchPanel.goToSettings')}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const url = urlJoin('/settings/provider', item.provider.id || 'all');
                if (e.ctrlKey || e.metaKey) {
                  window.open(url, '_blank');
                } else {
                  navigate(url);
                }
                onClose();
              }}
            />
          </Flexbox>
        );
      }

      case 'empty-model': {
        return (
          <Flexbox
            horizontal
            className={modelSwitchPanelStyles.menuItem}
            gap={8}
            style={{ color: cssVar.colorTextTertiary }}
            onClick={() => {
              navigate(`/settings/provider/${item.provider.id}`);
              onClose();
            }}
          >
            {t('ModelSwitchPanel.emptyModel')}
            <Icon icon={LucideArrowRight} />
          </Flexbox>
        );
      }

      case 'provider-model-item': {
        const key = menuKey(item.provider.id, item.model.id);
        const isActive = key === activeKey;
        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <DropdownMenuSubmenuRoot open={detailOpen} onOpenChange={setDetailOpen}>
              <DropdownMenuSubmenuTrigger
                style={{ paddingBlock: 8, paddingInline: 8 }}
                className={cx(
                  menuSharedStyles.item,
                  isActive && modelSwitchPanelStyles.menuItemActive,
                )}
                onClick={() => {
                  setDetailOpen(false);
                  onModelChange(item.model.id, item.provider.id);
                  onClose();
                }}
              >
                <ModelItemComponent
                  {...item.model}
                  providerId={item.provider.id}
                  showBadge={false}
                  showPopover={false}
                />
              </DropdownMenuSubmenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner anchor={null} placement="right" sideOffset={12}>
                  <DropdownMenuPopup className={modelSwitchPanelStyles.detailPopup}>
                    <ModelDetailPanel
                      enabledList={enabledList}
                      model={item.model.id}
                      provider={item.provider.id}
                    />
                  </DropdownMenuPopup>
                </DropdownMenuPositioner>
              </DropdownMenuPortal>
            </DropdownMenuSubmenuRoot>
          </Flexbox>
        );
      }

      case 'model-item-single': {
        const singleProvider = item.data.providers[0];
        const key = menuKey(singleProvider.id, item.data.model.id);
        const isActive = key === activeKey;
        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <DropdownMenuSubmenuRoot open={detailOpen} onOpenChange={setDetailOpen}>
              <DropdownMenuSubmenuTrigger
                style={{ paddingBlock: 8, paddingInline: 8 }}
                className={cx(
                  menuSharedStyles.item,
                  isActive && modelSwitchPanelStyles.menuItemActive,
                )}
                onClick={() => {
                  setDetailOpen(false);
                  onModelChange(item.data.model.id, singleProvider.id);
                  onClose();
                }}
              >
                <ModelItemComponent
                  {...item.data.model}
                  providerId={singleProvider.id}
                  showBadge={false}
                  showPopover={false}
                />
              </DropdownMenuSubmenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner anchor={null} placement="right" sideOffset={12}>
                  <DropdownMenuPopup className={modelSwitchPanelStyles.detailPopup}>
                    <ModelDetailPanel
                      enabledList={enabledList}
                      model={item.data.model.id}
                      provider={singleProvider.id}
                    />
                  </DropdownMenuPopup>
                </DropdownMenuPositioner>
              </DropdownMenuPortal>
            </DropdownMenuSubmenuRoot>
          </Flexbox>
        );
      }

      case 'model-item-multiple': {
        return (
          <MultipleProvidersItem
            ModelItemComponent={ModelItemComponent}
            activeKey={activeKey}
            enabledList={enabledList}
            item={item}
            onClose={onClose}
            onModelChange={onModelChange}
          />
        );
      }

      default: {
        return null;
      }
    }
  },
);

ListItemRenderer.displayName = 'ListItemRenderer';

export default ListItemRenderer;

import {
  ActionIcon,
  Block,
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
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { styles } from '../../styles';
import { type ListItem } from '../../types';
import { menuKey } from '../../utils';
import ModelDetailPanel from '../ModelDetailPanel';
import { MultipleProvidersModelItem } from './MultipleProvidersModelItem';
import { SingleProviderModelItem } from './SingleProviderModelItem';

interface ListItemRendererProps {
  activeKey: string;
  isModelRestricted?: (modelId: string, providerId: string) => boolean;
  item: ListItem;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => void;
  onRestrictedModelClick?: () => void;
  proLabel?: string;
  subscribeScroll?: (cb: () => void) => () => void;
}

export const ListItemRenderer = memo<ListItemRendererProps>(
  ({
    activeKey,
    isModelRestricted,
    item,
    newLabel,
    onModelChange,
    onClose,
    onRestrictedModelClick,
    proLabel,
    subscribeScroll,
  }) => {
    const { t } = useTranslation('components');
    const navigate = useNavigate();
    const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
    const [detailOpen, setDetailOpen] = useState(false);

    useEffect(() => {
      return subscribeScroll?.(() => setDetailOpen(false));
    }, [subscribeScroll]);

    switch (item.type) {
      case 'no-provider': {
        return (
          <Block
            clickable
            horizontal
            className={styles.menuItem}
            gap={8}
            key="no-provider"
            style={{ color: cssVar.colorTextTertiary }}
            variant={'borderless'}
            onClick={() => navigate('/settings/provider/all')}
          >
            {t('ModelSwitchPanel.emptyProvider')}
            <Icon icon={LucideArrowRight} />
          </Block>
        );
      }

      case 'group-header': {
        return (
          <Flexbox
            horizontal
            className={styles.groupHeader}
            justify="space-between"
            key={`header-${item.provider.id}`}
            paddingBlock={'12px 4px'}
            paddingInline={'12px 8px'}
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
            className={styles.menuItem}
            gap={8}
            key={`empty-${item.provider.id}`}
            style={{ color: cssVar.colorTextTertiary }}
            onClick={() => navigate(`/settings/provider/${item.provider.id}`)}
          >
            {t('ModelSwitchPanel.emptyModel')}
            <Icon icon={LucideArrowRight} />
          </Flexbox>
        );
      }

      case 'provider-model-item': {
        const key = menuKey(item.provider.id, item.model.id);
        const isActive = key === activeKey;
        const restricted = isModelRestricted?.(item.model.id, item.provider.id);

        if (isDevMode) {
          return (
            <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
              <DropdownMenuSubmenuRoot open={detailOpen} onOpenChange={setDetailOpen}>
                <DropdownMenuSubmenuTrigger
                  className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
                  style={{ paddingBlock: 8, paddingInline: 8 }}
                  onClick={(e) => {
                    e.preventDefault();
                    setDetailOpen(false);
                    onClose();
                    onModelChange(item.model.id, item.provider.id);
                  }}
                >
                  <ModelItemRender
                    {...item.model}
                    {...item.model.abilities}
                    showInfoTag
                    newBadgeLabel={newLabel}
                  />
                </DropdownMenuSubmenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuPositioner anchor={null} placement="right" sideOffset={12}>
                    <DropdownMenuPopup className={styles.detailPopup}>
                      <ModelDetailPanel model={item.model.id} provider={item.provider.id} />
                    </DropdownMenuPopup>
                  </DropdownMenuPositioner>
                </DropdownMenuPortal>
              </DropdownMenuSubmenuRoot>
            </Flexbox>
          );
        }

        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <DropdownMenuSubmenuRoot open={detailOpen} onOpenChange={setDetailOpen}>
              <DropdownMenuSubmenuTrigger
                className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
                style={{ paddingBlock: 8, paddingInline: 8 }}
                onClick={(e) => {
                  e.preventDefault();
                  setDetailOpen(false);
                  if (restricted) {
                    onRestrictedModelClick?.();
                    onClose();
                    return;
                  }
                  onClose();
                  onModelChange(item.model.id, item.provider.id);
                }}
              >
                <ModelItemRender
                  {...item.model}
                  {...item.model.abilities}
                  newBadgeLabel={newLabel}
                  proBadgeLabel={restricted ? proLabel : undefined}
                />
              </DropdownMenuSubmenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner anchor={null} placement="right" sideOffset={12}>
                  <DropdownMenuPopup className={styles.detailPopup}>
                    <ModelDetailPanel model={item.model.id} provider={item.provider.id} />
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
        const restricted = isModelRestricted?.(item.data.model.id, singleProvider.id);

        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <DropdownMenuSubmenuRoot open={detailOpen} onOpenChange={setDetailOpen}>
              <DropdownMenuSubmenuTrigger
                className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
                style={{ paddingBlock: 8, paddingInline: 8 }}
                onClick={(e) => {
                  e.preventDefault();
                  setDetailOpen(false);
                  if (restricted) {
                    onRestrictedModelClick?.();
                    onClose();
                    return;
                  }
                  onClose();
                  onModelChange(item.data.model.id, singleProvider.id);
                }}
              >
                <SingleProviderModelItem
                  data={item.data}
                  newLabel={newLabel}
                  proBadgeLabel={restricted ? proLabel : undefined}
                  showInfoTag={isDevMode}
                />
              </DropdownMenuSubmenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner anchor={null} placement="right" sideOffset={16}>
                  <DropdownMenuPopup className={styles.detailPopup}>
                    <ModelDetailPanel model={item.data.model.id} provider={singleProvider.id} />
                  </DropdownMenuPopup>
                </DropdownMenuPositioner>
              </DropdownMenuPortal>
            </DropdownMenuSubmenuRoot>
          </Flexbox>
        );
      }

      case 'model-item-multiple': {
        return (
          <Flexbox key={item.data.displayName} style={{ marginBlock: 1, marginInline: 4 }}>
            <MultipleProvidersModelItem
              activeKey={activeKey}
              data={item.data}
              isModelRestricted={isModelRestricted}
              newLabel={newLabel}
              proLabel={proLabel}
              showInfoTag={isDevMode}
              onClose={onClose}
              onModelChange={onModelChange}
              onRestrictedModelClick={onRestrictedModelClick}
            />
          </Flexbox>
        );
      }

      default: {
        return null;
      }
    }
  },
);

ListItemRenderer.displayName = 'ListItemRenderer';

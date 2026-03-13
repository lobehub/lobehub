import {
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
import { LucideArrowRight } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

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
  onModelChange: (modelId: string, providerId: string) => Promise<void>;
  onRestrictedModelClick?: () => void;
  proLabel?: string;
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
  }) => {
    const { t } = useTranslation('components');
    const navigate = useNavigate();
    const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
    const [detailOpen, setDetailOpen] = useState(false);

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
                  onClick={async () => {
                    setDetailOpen(false);
                    onModelChange(item.model.id, item.provider.id);
                    onClose();
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
            <Block
              clickable
              className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
              style={{ paddingBlock: 8, paddingInline: 8 }}
              variant={'borderless'}
              onClick={async () => {
                if (restricted) {
                  onRestrictedModelClick?.();
                  onClose();
                  return;
                }
                onModelChange(item.model.id, item.provider.id);
                onClose();
              }}
            >
              <ModelItemRender
                {...item.model}
                {...item.model.abilities}
                newBadgeLabel={newLabel}
                proBadgeLabel={restricted ? proLabel : undefined}
              />
            </Block>
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
            <Block
              clickable
              className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
              style={{ paddingBlock: 8, paddingInline: 8 }}
              variant={'borderless'}
              onClick={async () => {
                if (restricted) {
                  onRestrictedModelClick?.();
                  onClose();
                  return;
                }
                onModelChange(item.data.model.id, singleProvider.id);
                onClose();
              }}
            >
              <SingleProviderModelItem
                data={item.data}
                newLabel={newLabel}
                proBadgeLabel={restricted ? proLabel : undefined}
                showInfoTag={isDevMode}
              />
            </Block>
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

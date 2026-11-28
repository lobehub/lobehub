import {
  ActionIcon,
  Block,
  cssVar,
  cx,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
  Flexbox,
  Icon,
  menuSharedStyles,
} from '@lobehub/ui';
import { LucideArrowRight, LucideBolt } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { ProviderItemRender } from '@/components/ModelSelect';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useInterfaceDensity } from '@/styles/density';

import { styles } from '../../styles';
import { type ListItem } from '../../types';
import { menuKey, resolveModelDisabledReason } from '../../utils';
import ModelDetailPanel from '../ModelDetailPanel';
import { DisabledModelReason } from './DisabledModelReason';
import { ModelRowRender } from './ModelRowRender';
import { MultipleProvidersModelItem } from './MultipleProvidersModelItem';

interface ListItemRendererProps {
  activeKey: string;
  /** Muted text shown after the active model's name, e.g. its reasoning effort */
  activeSecondaryText?: string;
  /** Why a listed model cannot be picked; a model with a reason renders dimmed and inert. */
  getDisabledReason?: (modelId: string, providerId: string) => string | undefined;
  /** Badge text of a restricted model */
  getRestrictedLabel?: (modelId: string, providerId: string) => string;
  isModelRestricted?: (modelId: string, providerId: string) => boolean;
  item: ListItem;
  newLabel: string;
  onBeforeModelSelect?: (modelId: string, providerId: string) => boolean | Promise<boolean>;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => void;
  onRestrictedModelClick?: (modelId: string, providerId: string) => void;
  subscribeScroll?: (cb: () => void) => () => void;
}

export const ListItemRenderer = memo<ListItemRendererProps>(
  ({
    activeKey,
    activeSecondaryText,
    getDisabledReason,
    getRestrictedLabel,
    isModelRestricted,
    item,
    newLabel,
    onBeforeModelSelect,
    onModelChange,
    onClose,
    onRestrictedModelClick,
    subscribeScroll,
  }) => {
    const { t } = useTranslation('components');
    const navigate = useWorkspaceAwareNavigate();
    const activeSlug = useActiveWorkspaceSlug();
    const compact = useInterfaceDensity() === 'compact';
    const [detailOpen, setDetailOpen] = useState(false);

    const selectModel = async (modelId: string, providerId: string) => {
      onClose();
      if ((await onBeforeModelSelect?.(modelId, providerId)) === false) return;

      onModelChange(modelId, providerId);
    };

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
            onClick={() => {
              onClose();
              navigate('/settings/provider/all');
            }}
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
            paddingBlock={compact ? '8px 2px' : '12px 4px'}
            paddingInline={compact ? '10px 8px' : '12px 8px'}
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
                  window.open(buildWorkspaceAwarePath(url, activeSlug), '_blank');
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
            onClick={() => {
              onClose();
              navigate(`/settings/provider/${item.provider.id}`);
            }}
          >
            {t('ModelSwitchPanel.emptyModel')}
            <Icon icon={LucideArrowRight} />
          </Flexbox>
        );
      }

      case 'featured-model-item':
      case 'provider-model-item': {
        const key = menuKey(item.provider.id, item.model.id);
        const isActive = key === activeKey;
        const restricted = isModelRestricted?.(item.model.id, item.provider.id);
        const disabledReason = resolveModelDisabledReason(
          { getDisabledReason, isModelRestricted },
          item.model.id,
          item.provider.id,
        );

        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <DropdownMenuSubmenuRoot open={detailOpen} onOpenChange={setDetailOpen}>
              <DropdownMenuSubmenuTrigger
                aria-description={disabledReason}
                aria-disabled={disabledReason ? true : undefined}
                className={cx(
                  menuSharedStyles.item,
                  styles.rowTrigger,
                  isActive && styles.menuItemActive,
                  disabledReason && styles.rowDisabled,
                )}
                onClick={(e) => {
                  e.preventDefault();
                  // Inert: the hover panel already says why it cannot be picked.
                  if (disabledReason) return;
                  setDetailOpen(false);
                  if (restricted) {
                    onRestrictedModelClick?.(item.model.id, item.provider.id);
                    onClose();
                    return;
                  }
                  void selectModel(item.model.id, item.provider.id);
                }}
              >
                <ModelRowRender
                  activeEffortLabel={activeSecondaryText}
                  badge={item.type === 'featured-model-item' ? item.badge : undefined}
                  disabled={!!disabledReason}
                  isActive={isActive}
                  model={item.model}
                  newLabel={newLabel}
                  pricePlaceholder={item.type === 'featured-model-item' ? '—' : undefined}
                  provider={item.provider.id}
                  proBadgeLabel={
                    restricted ? getRestrictedLabel?.(item.model.id, item.provider.id) : undefined
                  }
                />
              </DropdownMenuSubmenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner anchor={null} placement="right" sideOffset={12}>
                  <DropdownMenuPopup className={styles.detailPopup}>
                    {disabledReason && <DisabledModelReason reason={disabledReason} />}
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
        const disabledReason = resolveModelDisabledReason(
          { getDisabledReason, isModelRestricted },
          item.data.model.id,
          singleProvider.id,
        );

        return (
          <Flexbox style={{ marginBlock: 1, marginInline: 4 }}>
            <DropdownMenuSubmenuRoot open={detailOpen} onOpenChange={setDetailOpen}>
              <DropdownMenuSubmenuTrigger
                aria-description={disabledReason}
                aria-disabled={disabledReason ? true : undefined}
                className={cx(
                  menuSharedStyles.item,
                  styles.rowTrigger,
                  isActive && styles.menuItemActive,
                  disabledReason && styles.rowDisabled,
                )}
                onClick={(e) => {
                  e.preventDefault();
                  // Inert: the hover panel already says why it cannot be picked.
                  if (disabledReason) return;
                  setDetailOpen(false);
                  if (restricted) {
                    onRestrictedModelClick?.(item.data.model.id, singleProvider.id);
                    onClose();
                    return;
                  }
                  void selectModel(item.data.model.id, singleProvider.id);
                }}
              >
                <ModelRowRender
                  activeEffortLabel={activeSecondaryText}
                  disabled={!!disabledReason}
                  isActive={isActive}
                  model={item.data.model}
                  newLabel={newLabel}
                  provider={singleProvider.id}
                  proBadgeLabel={
                    restricted
                      ? getRestrictedLabel?.(item.data.model.id, singleProvider.id)
                      : undefined
                  }
                />
              </DropdownMenuSubmenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuPositioner anchor={null} placement="right" sideOffset={16}>
                  <DropdownMenuPopup className={styles.detailPopup}>
                    {disabledReason && <DisabledModelReason reason={disabledReason} />}
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
              activeSecondaryText={activeSecondaryText}
              data={item.data}
              getDisabledReason={getDisabledReason}
              getRestrictedLabel={getRestrictedLabel}
              isModelRestricted={isModelRestricted}
              newLabel={newLabel}
              onBeforeModelSelect={onBeforeModelSelect}
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

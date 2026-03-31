import {
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuItemLabel,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
  Flexbox,
  menuSharedStyles,
  Tag,
} from '@lobehub/ui';
import { cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';

import { styles } from '../../styles';
import { type ModelWithProviders } from '../../types';
import { menuKey } from '../../utils';
import ModelDetailPanel from '../ModelDetailPanel';

interface MultipleProvidersModelItemProps {
  activeKey: string;
  data: ModelWithProviders;
  defaultProviderId?: string;
  isModelRestricted?: (modelId: string, providerId: string) => boolean;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => void;
  onRestrictedModelClick?: () => void;
  proLabel?: string;
  showInfoTag?: boolean;
}

export const MultipleProvidersModelItem = memo<MultipleProvidersModelItemProps>(
  ({
    activeKey,
    data,
    isModelRestricted,
    newLabel,
    onModelChange,
    onClose,
    onRestrictedModelClick,
    proLabel,
    showInfoTag,
  }) => {
    const { t } = useTranslation('components');
    const [submenuOpen, setSubmenuOpen] = useState(false);

    const activeProvider = data.providers.find((p) => menuKey(p.id, data.model.id) === activeKey);
    const isActive = !!activeProvider;

    const allRestricted =
      isModelRestricted &&
      data.providers.length > 0 &&
      data.providers.every((p) => isModelRestricted(data.model.id, p.id));

    return (
      <DropdownMenuSubmenuRoot
        open={submenuOpen}
        onOpenChange={(open) => {
          if (allRestricted && open) return;
          setSubmenuOpen(open);
        }}
      >
        <DropdownMenuSubmenuTrigger
          className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
          style={{ paddingBlock: 8, paddingInline: 8 }}
          onClick={() => {
            if (allRestricted) {
              onRestrictedModelClick?.();
              onClose();
              return;
            }
            setSubmenuOpen(false);
            onModelChange(data.model.id, data.providers[0].id);
            onClose();
          }}
        >
          <ModelItemRender
            {...data.model}
            {...data.model.abilities}
            newBadgeLabel={newLabel}
            proBadgeLabel={allRestricted ? proLabel : undefined}
            showInfoTag={showInfoTag}
          />
        </DropdownMenuSubmenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner anchor={null} placement="right" sideOffset={12}>
            <DropdownMenuPopup className={cx(styles.detailPopup, styles.dropdownMenu)}>
              {showInfoTag && (
                <ModelDetailPanel
                  model={data.model.id}
                  provider={(activeProvider ?? data.providers[0]).id}
                />
              )}
              <DropdownMenuGroup>
                <DropdownMenuGroupLabel>
                  {t('ModelSwitchPanel.useModelFrom')}
                </DropdownMenuGroupLabel>
                {data.providers.map((p) => {
                  const key = menuKey(p.id, data.model.id);
                  const isProviderActive = isActive ? activeKey === key : p.id === 'lobehub';
                  const providerRestricted = isModelRestricted?.(data.model.id, p.id);

                  return (
                    <DropdownMenuItem
                      key={key}
                      onClick={() => {
                        if (providerRestricted) {
                          onRestrictedModelClick?.();
                          onClose();
                          return;
                        }
                        setSubmenuOpen(false);
                        onClose();
                        onModelChange(data.model.id, p.id);
                      }}
                    >
                      <DropdownMenuItemIcon>
                        {isProviderActive ? <Check size={16} /> : null}
                      </DropdownMenuItemIcon>
                      <DropdownMenuItemLabel>
                        <Flexbox horizontal align="center" gap={8}>
                          <Flexbox horizontal align="center" style={{ flex: 'none' }}>
                            <ProviderItemRender
                              logo={p.logo}
                              name={p.name}
                              provider={p.id}
                              size={20}
                              source={p.source}
                              type={'avatar'}
                            />
                          </Flexbox>
                          {providerRestricted && proLabel && (
                            <Tag color="gold" size="small">
                              {proLabel}
                            </Tag>
                          )}
                        </Flexbox>
                      </DropdownMenuItemLabel>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuSubmenuRoot>
    );
  },
);

MultipleProvidersModelItem.displayName = 'MultipleProvidersModelItem';

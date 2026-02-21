import {
  ActionIcon,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuItemExtra,
  DropdownMenuItemIcon,
  DropdownMenuItemLabel,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
  menuSharedStyles,
} from '@lobehub/ui';
import { cx } from 'antd-style';
import { Check, LucideBolt } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';

import { styles } from '../../styles';
import { type ModelWithProviders } from '../../types';
import { menuKey } from '../../utils';
import ModelDetailPanel from '../ModelDetailPanel';

interface MultipleProvidersModelItemProps {
  activeKey: string;
  data: ModelWithProviders;
  extraControls?: (modelId: string, providerId: string) => ReactNode;
  isScrolling: boolean;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => Promise<void>;
}

export const MultipleProvidersModelItem = memo<MultipleProvidersModelItemProps>(
  ({ activeKey, data, extraControls, isScrolling, newLabel, onModelChange, onClose }) => {
    const { t } = useTranslation('components');
    const navigate = useNavigate();
    const [submenuOpen, setSubmenuOpen] = useState(false);

    useEffect(() => {
      if (isScrolling) {
        setSubmenuOpen(false);
      }
    }, [isScrolling]);

    const activeProvider = data.providers.find((p) => menuKey(p.id, data.model.id) === activeKey);
    const isActive = !!activeProvider;

    return (
      <DropdownMenuSubmenuRoot open={submenuOpen} onOpenChange={setSubmenuOpen}>
        <DropdownMenuSubmenuTrigger
          className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
          style={{ paddingBlock: 8, paddingInline: 8 }}
        >
          <ModelItemRender
            {...data.model}
            {...data.model.abilities}
            newBadgeLabel={newLabel}
            showInfoTag={true}
          />
        </DropdownMenuSubmenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner anchor={null} placement="right" sideOffset={8}>
            <DropdownMenuPopup className={cx(styles.detailPopup, styles.dropdownMenu)}>
              <ModelDetailPanel
                model={data.model}
                extraControls={extraControls?.(
                  data.model.id,
                  (activeProvider ?? data.providers[0]).id,
                )}
              />
              <DropdownMenuGroup>
                <DropdownMenuGroupLabel>
                  {t('ModelSwitchPanel.useModelFrom')}
                </DropdownMenuGroupLabel>
                {data.providers.map((p) => {
                  const key = menuKey(p.id, data.model.id);
                  const isProviderActive = activeKey === key;

                  return (
                    <DropdownMenuItem
                      key={key}
                      onClick={async () => {
                        await onModelChange(data.model.id, p.id);
                        onClose();
                      }}
                    >
                      <DropdownMenuItemIcon>
                        {isProviderActive ? <Check size={16} /> : null}
                      </DropdownMenuItemIcon>
                      <DropdownMenuItemLabel>
                        <ProviderItemRender
                          logo={p.logo}
                          name={p.name}
                          provider={p.id}
                          size={20}
                          source={p.source}
                          type={'avatar'}
                        />
                      </DropdownMenuItemLabel>
                      <DropdownMenuItemExtra>
                        <ActionIcon
                          className={'settings-icon'}
                          icon={LucideBolt}
                          size={'small'}
                          title={t('ModelSwitchPanel.goToSettings')}
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
                        />
                      </DropdownMenuItemExtra>
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

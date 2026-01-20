import { ActionIcon, type DropdownItem, DropdownMenu } from '@lobehub/ui';
import { Check, LucideBolt } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';

import { styles } from '../../styles';
import type { ModelWithProviders } from '../../types';
import { menuKey } from '../../utils';

interface MultipleProvidersModelItemProps {
  activeKey: string;
  data: ModelWithProviders;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => Promise<void>;
}

export const MultipleProvidersModelItem = memo<MultipleProvidersModelItemProps>(
  ({ activeKey, data, newLabel, onModelChange, onClose }) => {
    const { t } = useTranslation('components');
    const navigate = useNavigate();

    const items = useMemo(
      () =>
        [
          {
            key: 'header',
            label: t('ModelSwitchPanel.useModelFrom'),
            type: 'group',
          },
          ...data.providers.map((p) => {
            const key = menuKey(p.id, data.model.id);

            return {
              extra: (
                <ActionIcon
                  className={'settings-icon'}
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
              ),
              icon: activeKey === key ? Check : undefined,
              key,
              label: (
                <ProviderItemRender
                  logo={p.logo}
                  name={p.name}
                  provider={p.id}
                  size={20}
                  source={p.source}
                  type={'avatar'}
                />
              ),
              onClick: async () => {
                onModelChange(data.model.id, p.id);
                onClose();
              },
            };
          }),
        ] as DropdownItem[],
      [activeKey, data.model.id, data.providers, navigate, onModelChange, onClose, t],
    );

    return (
      <DropdownMenu
        items={items}
        placement="rightTop"
        popupProps={{ className: styles.dropdownMenu }}
        positionerProps={{
          alignOffset: -48,
          sideOffset: 12,
        }}
      >
        <ModelItemRender
          {...data.model}
          {...data.model.abilities}
          newBadgeLabel={newLabel}
          showInfoTag={true}
        />
      </DropdownMenu>
    );
  },
);

MultipleProvidersModelItem.displayName = 'MultipleProvidersModelItem';

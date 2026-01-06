import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { LucideArrowRight, LucideBolt } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';

import { ModelMenuItem } from './ModelMenuItem';
import { styles } from './styles';
import type { VirtualItem } from './types';
import { menuKey } from './utils';

interface VirtualItemRendererProps {
  activeKey: string;
  item: VirtualItem;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => Promise<void>;
}

export const VirtualItemRenderer = memo<VirtualItemRendererProps>(
  ({ activeKey, item, newLabel, onModelChange, onClose }) => {
    const { t } = useTranslation('components');
    const navigate = useNavigate();

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
            className={`${styles.menuItem} ${isActive ? styles.menuItemActive : ''}`}
            key={key}
            onClick={async () => {
              await onModelChange(item.model.id, item.provider.id);
              onClose();
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
        return (
          <ModelMenuItem
            activeKey={activeKey}
            data={item.data}
            key={item.data.displayName}
            newLabel={newLabel}
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

VirtualItemRenderer.displayName = 'VirtualItemRenderer';

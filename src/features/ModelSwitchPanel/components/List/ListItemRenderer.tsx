import { ActionIcon, Block, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { LucideArrowRight, LucideBolt } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';

import { styles } from '../../styles';
import { type ListItem } from '../../types';
import { menuKey } from '../../utils';
import { MultipleProvidersModelItem } from './MultipleProvidersModelItem';
import { SingleProviderModelItem } from './SingleProviderModelItem';

interface ListItemRendererProps {
  activeKey: string;
  isScrolling: boolean;
  item: ListItem;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => Promise<void>;
}

export const ListItemRenderer = memo<ListItemRendererProps>(
  ({ activeKey, isScrolling, item, newLabel, onModelChange, onClose }) => {
    const { t } = useTranslation('components');
    const navigate = useNavigate();

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
              size={'small'}
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

        return (
          <Block
            clickable
            className={styles.menuItem}
            key={key}
            variant={isActive ? 'filled' : 'borderless'}
            onClick={async () => {
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
          </Block>
        );
      }

      case 'model-item-single': {
        const singleProvider = item.data.providers[0];
        const key = menuKey(singleProvider.id, item.data.model.id);
        const isActive = key === activeKey;

        return (
          <Block
            clickable
            className={styles.menuItem}
            key={key}
            variant={isActive ? 'filled' : 'borderless'}
            onClick={async () => {
              onModelChange(item.data.model.id, singleProvider.id);
              onClose();
            }}
          >
            <SingleProviderModelItem data={item.data} newLabel={newLabel} />
          </Block>
        );
      }

      case 'model-item-multiple': {
        return (
          <Flexbox key={item.data.displayName} style={{ marginBlock: 1, marginInline: 4 }}>
            <MultipleProvidersModelItem
              activeKey={activeKey}
              data={item.data}
              isScrolling={isScrolling}
              newLabel={newLabel}
              onClose={onClose}
              onModelChange={onModelChange}
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

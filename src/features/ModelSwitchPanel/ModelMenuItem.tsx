import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { Dropdown } from 'antd';
import { cssVar, cx } from 'antd-style';
import { LucideBolt, LucideCheck, LucideChevronRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';

import { styles } from './styles';
import type { ModelWithProviders } from './types';
import { menuKey } from './utils';

interface ModelMenuItemProps {
  activeKey: string;
  data: ModelWithProviders;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => Promise<void>;
}

export const ModelMenuItem = memo<ModelMenuItemProps>(
  ({ activeKey, data, newLabel, onModelChange, onClose }) => {
    const { t } = useTranslation('components');
    const navigate = useNavigate();

    const hasSingleProvider = data.providers.length === 1;

    // Check if this model is currently active and find active provider
    const activeProvider = data.providers.find((p) => menuKey(p.id, data.model.id) === activeKey);
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
              await onModelChange(data.model.id, singleProvider.id);
              onClose();
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
                  await onModelChange(data.model.id, p.id);
                  onClose();
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
  },
);

ModelMenuItem.displayName = 'ModelMenuItem';

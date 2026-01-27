import { Flexbox, Icon, type ItemType, Segmented } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, ExternalLink, Settings, Store } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import ToolsList, { toolsListStyles } from '@/features/ChatInput/ActionBar/Tools/ToolsList';

import Empty from './Empty';

type TabType = 'all' | 'installed';

const SKILL_ICON_SIZE = 20;

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    padding: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  header: css`
    padding: ${cssVar.paddingXS};
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: transparent;
  `,
  scroller: css`
    overflow: hidden auto;
  `,
  trailingIcon: css`
    opacity: 0.5;
  `,
}));

interface PopoverContentProps {
  activeTab: TabType;
  allTabItems: ItemType[];
  installedTabItems: ItemType[];
  onClose?: () => void;
  onOpenStore: () => void;
  onTabChange: (tab: TabType) => void;
}

const PopoverContent = memo<PopoverContentProps>(
  ({ activeTab, onTabChange, allTabItems, installedTabItems, onOpenStore, onClose }) => {
    const { t } = useTranslation('setting');
    const navigate = useNavigate();

    const currentItems = activeTab === 'all' ? allTabItems : installedTabItems;

    return (
      <Flexbox style={{ maxHeight: 500, width: '100%' }}>
        {/* stopPropagation prevents dropdown's onClick from calling preventDefault on Segmented */}
        <div className={styles.header} onClick={(e) => e.stopPropagation()}>
          <Segmented
            block
            onChange={(v) => onTabChange(v as TabType)}
            options={[
              {
                label: t('tools.tabs.all', { defaultValue: 'All' }),
                value: 'all',
              },
              {
                label: t('tools.tabs.installed', { defaultValue: 'Installed' }),
                value: 'installed',
              },
            ]}
            size="small"
            value={activeTab}
          />
        </div>
        <div className={styles.scroller} style={{ flex: 1 }}>
          {activeTab === 'installed' && installedTabItems.length === 0 ? (
            <Empty />
          ) : (
            <ToolsList items={currentItems} />
          )}
        </div>
        <div className={styles.footer}>
          <div className={toolsListStyles.item} onClick={onOpenStore} role="button" tabIndex={0}>
            <div className={toolsListStyles.itemIcon}>
              <Icon icon={Store} size={SKILL_ICON_SIZE} />
            </div>
            <div className={toolsListStyles.itemContent}>{t('skillStore.title')}</div>
            <Icon className={styles.trailingIcon} icon={ChevronRight} size={16} />
          </div>
          <div
            className={toolsListStyles.item}
            onClick={() => {
              onClose?.();
              navigate('/settings/skill');
            }}
            role="button"
            tabIndex={0}
          >
            <div className={toolsListStyles.itemIcon}>
              <Icon icon={Settings} size={SKILL_ICON_SIZE} />
            </div>
            <div className={toolsListStyles.itemContent}>{t('tools.plugins.management')}</div>
            <Icon className={styles.trailingIcon} icon={ExternalLink} size={16} />
          </div>
        </div>
      </Flexbox>
    );
  },
);

PopoverContent.displayName = 'PopoverContent';

export default PopoverContent;

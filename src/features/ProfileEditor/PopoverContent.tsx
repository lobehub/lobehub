import { Flexbox, Icon, type ItemType, Segmented } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowRight, ExternalLink, Settings, Store } from 'lucide-react';
import { type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Empty from './Empty';

type TabType = 'all' | 'installed';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css }) => ({
  dropdown: css`
    overflow: hidden;
    width: 100%;

    .${prefixCls}-dropdown-menu {
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
  `,
  footerItem: css`
    cursor: pointer;

    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 6px;

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  footerItemContent: css`
    flex: 1;
    min-width: 0;
  `,
  footerItemIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
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
  installedTabItems: ItemType[];
  menu: ReactNode;
  onClose?: () => void;
  onOpenStore: () => void;
  onTabChange: (tab: TabType) => void;
}

const PopoverContent = memo<PopoverContentProps>(
  ({ menu, activeTab, onTabChange, installedTabItems, onOpenStore, onClose }) => {
    const { t } = useTranslation('setting');
    const navigate = useNavigate();

    return (
      <Flexbox className={styles.dropdown} style={{ maxHeight: 500 }}>
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
          {activeTab === 'installed' && installedTabItems.length === 0 ? <Empty /> : menu}
        </div>
        <div
          style={{
            borderBlockStart: `1px solid ${cssVar.colorBorderSecondary}`,
            padding: 4,
          }}
        >
          <div className={styles.footerItem} onClick={onOpenStore} role="button" tabIndex={0}>
            <div className={styles.footerItemIcon}>
              <Icon icon={Store} size={20} />
            </div>
            <div className={styles.footerItemContent}>{t('skillStore.title')}</div>
            <Icon className={styles.trailingIcon} icon={ArrowRight} size={16} />
          </div>
          <div
            className={styles.footerItem}
            onClick={() => {
              onClose?.();
              navigate('/settings/skill');
            }}
            role="button"
            tabIndex={0}
          >
            <div className={styles.footerItemIcon}>
              <Icon icon={Settings} size={20} />
            </div>
            <div className={styles.footerItemContent}>{t('tools.plugins.management')}</div>
            <Icon className={styles.trailingIcon} icon={ExternalLink} size={16} />
          </div>
        </div>
      </Flexbox>
    );
  },
);

PopoverContent.displayName = 'PopoverContent';

export default PopoverContent;

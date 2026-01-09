import { Flexbox, Icon, type ItemType, Segmented, usePopoverContext } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, Store } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ToolsList, { toolsListStyles } from './ToolsList';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    padding: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  header: css`
    padding: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  trailingIcon: css`
    opacity: 0.5;
  `,
}));

type TabType = 'all' | 'installed';

interface PopoverContentProps {
  activeTab: TabType;
  currentItems: ItemType[];
  enableKlavis: boolean;
  onOpenStore: () => void;
  onTabChange: (tab: TabType) => void;
}

const PopoverContent = memo<PopoverContentProps>(
  ({ activeTab, currentItems, enableKlavis, onTabChange, onOpenStore }) => {
    const { t } = useTranslation('setting');

    const { close: closePopover } = usePopoverContext();

    return (
      <Flexbox gap={0}>
        <div className={styles.header}>
          <Segmented
            block
            onChange={(v) => onTabChange(v as TabType)}
            options={[
              {
                label: t('tools.tabs.all', { defaultValue: 'all' }),
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
        <div
          style={{
            maxHeight: 500,
            minHeight: enableKlavis ? 500 : undefined,
            overflowY: 'auto',
          }}
        >
          <ToolsList items={currentItems} />
        </div>
        <div className={styles.footer}>
          <div
            className={toolsListStyles.item}
            onClick={() => {
              closePopover();
              onOpenStore();
            }}
            role="button"
            tabIndex={0}
          >
            <div className={toolsListStyles.itemIcon}>
              <Icon icon={Store} size={20} />
            </div>
            <div className={toolsListStyles.itemContent}>{t('tools.plugins.store')}</div>
            <Icon className={styles.trailingIcon} icon={ChevronRight} size={16} />
          </div>
        </div>
      </Flexbox>
    );
  },
);

PopoverContent.displayName = 'PopoverContent';

export default PopoverContent;

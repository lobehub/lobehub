import { Flexbox, Icon, type ItemType, Segmented, usePopoverContext } from '@lobehub/ui';
import { ChevronRight, Store } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ToolsList, { toolsListStyles } from './ToolsList';

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
        <div style={{ borderBottom: '1px solid var(--ant-color-border-secondary)', padding: 8 }}>
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
        <div style={{ borderTop: '1px solid var(--ant-color-border-secondary)', padding: 4 }}>
          <div
            className={toolsListStyles.item}
            onClick={() => {
              closePopover();
              onOpenStore();
            }}
            role="button"
            tabIndex={0}
          >
            <Icon icon={Store} size={20} />
            <div className={toolsListStyles.itemContent}>{t('tools.plugins.store')}</div>
            <Icon icon={ChevronRight} size={16} style={{ opacity: 0.5 }} />
          </div>
        </div>
      </Flexbox>
    );
  },
);

PopoverContent.displayName = 'PopoverContent';

export default PopoverContent;

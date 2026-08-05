import { type ItemType } from '@lobehub/ui';
import { Flexbox, Icon, SearchBar, stopPropagation } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, ExternalLink, Settings, Store } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ScrollSignalProvider } from '@/features/ChatInput/ActionBar/Tools/ScrollSignalContext';
import ToolsList, { toolsListStyles } from '@/features/ChatInput/ActionBar/Tools/ToolsList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import Empty from './Empty';

const SKILL_ICON_SIZE = 20;

const filterItems = (items: ItemType[], keyword: string): ItemType[] => {
  const lower = keyword.toLowerCase();

  return items
    .map((item) => {
      if (!item) return null;

      if (item.type === 'group' && 'children' in item && item.children) {
        const filtered = item.children.filter((child) => {
          if (!child) return false;
          const key = String(child.key || '').toLowerCase();
          return key.includes(lower);
        });
        if (filtered.length === 0) return null;
        return { ...item, children: filtered };
      }

      if (item.type === 'divider') return item;

      const key = String('key' in item ? item.key : '').toLowerCase();
      return key.includes(lower) ? item : null;
    })
    .filter(Boolean) as ItemType[];
};

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    padding: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  header: css`
    padding-block: 8px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorFill};
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
  items: ItemType[];
  onClose?: () => void;
  onOpenStore: () => void;
}

const PopoverContent = memo<PopoverContentProps>(({ items, onOpenStore, onClose }) => {
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const [searchKeyword, setSearchKeyword] = useState('');

  const filteredItems = useMemo(
    () => (searchKeyword ? filterItems(items, searchKeyword) : items),
    [items, searchKeyword],
  );

  const isEmpty = filteredItems.length === 0;

  return (
    <Flexbox style={{ maxHeight: 500, width: '100%' }}>
      <div className={styles.header} onClick={stopPropagation}>
        <SearchBar
          allowClear
          placeholder={t('tools.search')}
          size="small"
          style={{ flex: 1 }}
          value={searchKeyword}
          variant="borderless"
          onChange={(e) => setSearchKeyword(e.target.value)}
          onKeyDown={stopPropagation}
        />
      </div>
      <ScrollSignalProvider className={styles.scroller} style={{ flex: 1 }}>
        {isEmpty ? <Empty /> : <ToolsList items={filteredItems} />}
      </ScrollSignalProvider>
      <div className={styles.footer}>
        <div className={toolsListStyles.item} role="button" tabIndex={0} onClick={onOpenStore}>
          <div className={toolsListStyles.itemIcon}>
            <Icon icon={Store} size={SKILL_ICON_SIZE} />
          </div>
          <div className={toolsListStyles.itemContent}>{t('skillStore.title')}</div>
          <Icon className={styles.trailingIcon} icon={ChevronRight} size={16} />
        </div>
        <div
          className={toolsListStyles.item}
          role="button"
          tabIndex={0}
          onClick={() => {
            onClose?.();
            navigate('/settings/connector');
          }}
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
});

PopoverContent.displayName = 'PopoverContent';

export default PopoverContent;

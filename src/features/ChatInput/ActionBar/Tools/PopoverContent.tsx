import { type ItemType } from '@lobehub/ui';
import { Flexbox, Icon, SearchBar, stopPropagation, usePopoverContext } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRight, ExternalLink, Settings, Store } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import SkillActivateMode from './SkillActivateMode';
import ToolsList, { toolsListStyles } from './ToolsList';

const styles = createStaticStyles(({ css }) => ({
  footer: css`
    padding: 4px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  header: css`
    padding-block: 8px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  trailingIcon: css`
    opacity: 0.5;
  `,
}));

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

interface PopoverContentProps {
  items: ItemType[];
  onOpenStore: () => void;
}

const PopoverContent = memo<PopoverContentProps>(({ items, onOpenStore }) => {
  const { t } = useTranslation('setting');
  const navigate = useNavigate();
  const [searchKeyword, setSearchKeyword] = useState('');

  const { close: closePopover } = usePopoverContext();

  const filteredItems = useMemo(
    () => (searchKeyword ? filterItems(items, searchKeyword) : items),
    [items, searchKeyword],
  );

  return (
    <Flexbox gap={0}>
      <Flexbox horizontal align="center" className={styles.header} gap={4}>
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
        <SkillActivateMode />
      </Flexbox>
      <div
        style={{
          height: 480,
          overflowY: 'auto',
        }}
      >
        <ToolsList items={filteredItems} />
      </div>
      <div className={styles.footer}>
        <div
          className={toolsListStyles.item}
          role="button"
          tabIndex={0}
          onClick={() => {
            closePopover();
            onOpenStore();
          }}
        >
          <div className={toolsListStyles.itemIcon}>
            <Icon icon={Store} size={20} />
          </div>
          <div className={toolsListStyles.itemContent}>{t('skillStore.title')}</div>
          <Icon className={styles.trailingIcon} icon={ChevronRight} size={16} />
        </div>
        <div
          className={toolsListStyles.item}
          role="button"
          tabIndex={0}
          onClick={() => {
            closePopover();
            navigate('/settings/skill');
          }}
        >
          <div className={toolsListStyles.itemIcon}>
            <Icon icon={Settings} size={20} />
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

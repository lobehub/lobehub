import { type ItemType } from '@lobehub/ui';
import { Flexbox, Icon, SearchBar, stopPropagation, usePopoverContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Pin, Settings, Store, Zap } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { ScrollSignalProvider } from './ScrollSignalContext';
import SkillActivateMode from './SkillActivateMode';
import ToolsList from './ToolsList';

const styles = stylex.create({
  footer: {
    display: 'flex',
    gap: '14px',
    alignItems: 'center',
    paddingBlock: '6px',
    paddingInline: '12px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorFill,
  },
  header: {
    paddingBlock: '8px',
    paddingInline: '8px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorFill,
  },
  iconButton: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderStyle: 'none',
    borderRadius: '6px',
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorTextSecondary },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'color 0.2s, background 0.2s',
  },
  statsItem: {
    display: 'inline-flex',
    gap: '5px',
    alignItems: 'center',
    fontSize: '12px',
    lineHeight: '18px',
    color: cssVar.colorTextTertiary,
  },
  storeButton: {
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    height: '28px',
    paddingInline: '8px',
    borderStyle: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': 'none', ':hover': 'none' },
    transition: 'color 0.2s, background 0.2s',
  },
});

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
  autoCount: number;
  detailPopoverDisabled?: boolean;
  items: ItemType[];
  onOpenStore: () => void;
  pinnedCount: number;
}

const PopoverContent = memo<PopoverContentProps>(
  ({ autoCount, detailPopoverDisabled, items, onOpenStore, pinnedCount }) => {
    const { t } = useTranslation('setting');
    const navigate = useWorkspaceAwareNavigate();
    const [searchKeyword, setSearchKeyword] = useState('');

    const { close: closePopover } = usePopoverContext();

    const filteredItems = useMemo(
      () => (searchKeyword ? filterItems(items, searchKeyword) : items),
      [items, searchKeyword],
    );

    return (
      <Flexbox gap={0}>
        <Flexbox
          horizontal
          align="center"
          className={stylex.props(styles.header).className}
          gap={4}
        >
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
        <ScrollSignalProvider
          style={{
            height: 480,
            overflowY: 'auto',
          }}
        >
          <ToolsList detailPopoverDisabled={detailPopoverDisabled} items={filteredItems} />
        </ScrollSignalProvider>
        <div {...stylex.props(styles.footer)}>
          <span {...stylex.props(styles.statsItem)}>
            <Icon icon={Pin} size={12} />
            {pinnedCount}
          </span>
          <span {...stylex.props(styles.statsItem)}>
            <Icon icon={Zap} size={12} />
            {autoCount}
          </span>
          <Flexbox horizontal align="center" gap={2} style={{ marginInlineStart: 'auto' }}>
            <button
              {...stylex.props(styles.storeButton)}
              type="button"
              onClick={() => {
                closePopover();
                onOpenStore();
              }}
            >
              <Icon icon={Store} size={14} />
              {t('tools.addSkillOrConnector')}
            </button>
            <button
              aria-label={t('tools.plugins.management')}
              {...stylex.props(styles.iconButton)}
              type="button"
              onClick={() => {
                closePopover();
                navigate('/settings/connector');
              }}
            >
              <Icon icon={Settings} size={14} />
            </button>
          </Flexbox>
        </div>
      </Flexbox>
    );
  },
);

PopoverContent.displayName = 'PopoverContent';

export default PopoverContent;

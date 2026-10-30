import { cssVar, Flexbox, Icon, Input, Text, usePopoverContext } from '@lobehub/ui';
import { cssVar as stylexCssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SearchIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';

import { filterSwitcherItems, pickRecentItems, type SwitcherItem } from './switcherItems';
import moduleStyles from './SwitcherMenu.module.css';
import SwitcherRow from './SwitcherRow';
import { useSwitcherRecents } from './useSwitcherRecents';

const styles = stylex.create({
  list: {
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    flexGrow: '1',
    flexShrink: '1',
    flexBasis: 'auto',
    minHeight: '0',
    maxHeight: 'min(360px, 50vh)',
    marginBlockEnd: 'calc(var(--switcher-inset) * -1)',
    marginInline: 'calc(var(--switcher-inset) * -1)',
    paddingBlockStart: '4px',
    paddingBlockEnd: 'var(--switcher-inset)',
    paddingInline: 'var(--switcher-inset)',
  },
  root: {
    '--switcher-inset': '6px',
    'overflow': 'hidden',
    'maxHeight': 'min(420px, 70vh)',
    'padding': 'var(--switcher-inset)',
  },
  search: {
    flex: 'none',
    marginInline: 'calc(var(--switcher-inset) * -1)',
    paddingBlockStart: '2px',
    paddingBlockEnd: '8px',
    paddingInline: '14px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: stylexCssVar.colorBorderSecondary,
  },
  section: {
    paddingBlockStart: '6px',
    paddingBlockEnd: '2px',
    paddingInline: '8px',
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: '16px',
    color: stylexCssVar.colorTextTertiary,
  },
});

interface SwitcherMenuProps {
  activeId?: string;
  error?: unknown;
  isLoading?: boolean;
  items: SwitcherItem[];
  kind: 'agent' | 'project';
  onRetry?: () => void;
  onSelect: (id: string) => void;
  searchPlaceholder: string;
}

const SwitcherMenu = memo<SwitcherMenuProps>(
  ({ activeId, error, isLoading, items, kind, onRetry, onSelect, searchPlaceholder }) => {
    const { t } = useTranslation('common');
    const { close } = usePopoverContext();
    const { ids, touch } = useSwitcherRecents(kind);
    const [query, setQuery] = useState('');

    useEffect(() => {
      if (activeId) touch(activeId);
    }, [activeId, touch]);

    const searching = query.trim().length > 0;
    const visibleItems = useMemo(() => filterSwitcherItems(items, query), [items, query]);
    const recentItems = useMemo(
      () => (searching ? [] : pickRecentItems(ids, items, { excludeId: activeId })),
      [activeId, ids, items, searching],
    );

    const handleSelect = (id: string) => {
      touch(id);
      close();
      if (id !== activeId) onSelect(id);
    };

    const showRecent = recentItems.length > 0;

    return (
      <Flexbox className={stylex.props(styles.root).className}>
        <div {...stylex.props(styles.search)}>
          <Input
            allowClear
            autoFocus
            className={moduleStyles.searchInput}
            placeholder={searchPlaceholder}
            prefix={<Icon color={cssVar.colorTextTertiary} icon={SearchIcon} size={14} />}
            size={'small'}
            value={query}
            variant={'borderless'}
            onChange={(event) => setQuery(event.target.value)}
            onPressEnter={() => {
              const first = visibleItems[0];
              if (first) handleSelect(first.id);
            }}
          />
        </div>
        <AsyncBoundary
          data={isLoading ? undefined : items}
          error={error}
          errorVariant={'inline'}
          isEmpty={searching && visibleItems.length === 0}
          isLoading={isLoading}
          loading={<SkeletonList rows={4} />}
          empty={
            <Flexbox align={'center'} padding={16}>
              <Text fontSize={13} type={'secondary'}>
                {t('navPanel.searchResultEmpty')}
              </Text>
            </Flexbox>
          }
          onRetry={onRetry}
        >
          <div {...stylex.props(styles.list)}>
            <Flexbox>
              {showRecent && (
                <>
                  <Text as={'div'} className={stylex.props(styles.section).className}>
                    {t('navPanel.switcherRecent', { defaultValue: 'Recent' })}
                  </Text>
                  {recentItems.map((item) => (
                    <SwitcherRow
                      item={item}
                      key={`recent-${item.id}`}
                      kind={kind}
                      privateLabel={t('navPanel.privateAgents')}
                      onSelect={handleSelect}
                    />
                  ))}
                </>
              )}
              {showRecent && (
                <Text as={'div'} className={stylex.props(styles.section).className}>
                  {t('navPanel.switcherAll', { defaultValue: 'All' })}
                </Text>
              )}
              {visibleItems.map((item) => (
                <SwitcherRow
                  active={item.id === activeId}
                  item={item}
                  key={item.id}
                  kind={kind}
                  privateLabel={t('navPanel.privateAgents')}
                  onSelect={handleSelect}
                />
              ))}
            </Flexbox>
          </div>
        </AsyncBoundary>
      </Flexbox>
    );
  },
);

SwitcherMenu.displayName = 'SwitcherMenu';

export default SwitcherMenu;

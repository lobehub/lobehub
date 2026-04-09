import type { ISlashMenuOption } from '@lobehub/editor';
import { memo } from 'react';

import MenuItem from './MenuItem';
import { styles } from './style';

interface SearchViewProps {
  activeKey: string | null;
  onSelectItem: (item: ISlashMenuOption) => void;
  options: ISlashMenuOption[];
}

const SEARCH_RESULT_CATEGORY_LABEL: Record<string, string> = {
  agent: 'Agent',
  member: 'Member',
  skill: 'Skill',
  tool: 'Tool',
  topic: 'Topic',
};

const getSearchResultCategoryLabel = (item: ISlashMenuOption): string | undefined => {
  const metadata = item.metadata as Record<string, unknown> | undefined;
  const type = metadata?.type;

  return typeof type === 'string' ? SEARCH_RESULT_CATEGORY_LABEL[type] : undefined;
};

const SearchView = memo<SearchViewProps>(({ options, activeKey, onSelectItem }) => {
  if (options.length === 0) {
    return <div className={styles.empty}>No results</div>;
  }

  return (
    <div className={styles.scrollArea}>
      {options.map((item) => {
        const categoryLabel = getSearchResultCategoryLabel(item);

        return (
          <MenuItem
            active={String(item.key) === activeKey}
            item={item}
            key={item.key}
            extra={
              categoryLabel ? (
                <span className={styles.categoryExtra}>{categoryLabel}</span>
              ) : undefined
            }
            onClick={onSelectItem}
          />
        );
      })}
    </div>
  );
});

SearchView.displayName = 'SearchView';

export default SearchView;

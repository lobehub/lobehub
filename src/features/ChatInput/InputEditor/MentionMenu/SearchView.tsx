import type { ISlashMenuOption } from '@lobehub/editor';
import { memo } from 'react';

import MenuItem from './MenuItem';
import { useStyles } from './style';

interface SearchViewProps {
  activeKey: string | null;
  onSelectItem: (item: ISlashMenuOption) => void;
  options: ISlashMenuOption[];
}

const SearchView = memo<SearchViewProps>(({ options, activeKey, onSelectItem }) => {
  const { styles } = useStyles();

  if (options.length === 0) {
    return <div className={styles.empty}>No results</div>;
  }

  return (
    <div className={styles.scrollArea}>
      {options.map((item) => (
        <MenuItem
          active={String(item.key) === activeKey}
          item={item}
          key={item.key}
          onClick={onSelectItem}
        />
      ))}
    </div>
  );
});

SearchView.displayName = 'SearchView';

export default SearchView;

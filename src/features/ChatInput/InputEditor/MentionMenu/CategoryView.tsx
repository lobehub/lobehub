import type { ISlashMenuOption } from '@lobehub/editor';
import { ArrowLeft } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo } from 'react';

import MenuItem from './MenuItem';
import { useStyles } from './style';
import type { MentionCategory } from './types';

interface CategoryViewProps {
  activeKey: string | null;
  category: MentionCategory;
  onBack: () => void;
  onSelectItem: (item: ISlashMenuOption) => void;
}

const CategoryView = memo<CategoryViewProps>(({ category, activeKey, onSelectItem, onBack }) => {
  const { styles } = useStyles();
  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  return (
    <>
      <div
        className={styles.backHeader}
        role="presentation"
        onClick={onBack}
        onMouseDown={handleMouseDown}
      >
        <ArrowLeft size={14} />
        {category.label}
      </div>
      <div className={styles.divider} />
      <div className={styles.scrollArea}>
        {category.items.map((item) => (
          <MenuItem
            active={String(item.key) === activeKey}
            item={item}
            key={item.key}
            onClick={onSelectItem}
          />
        ))}
      </div>
    </>
  );
});

CategoryView.displayName = 'CategoryView';

export default CategoryView;

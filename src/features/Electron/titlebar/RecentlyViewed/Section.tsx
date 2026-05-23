'use client';

import { memo } from 'react';

import { type ResolvedTab } from '../TabBar/hooks/useResolvedTabs';
import PageItem from './PageItem';
import { useStyles } from './styles';

interface SectionProps {
  isPinned: boolean;
  items: ResolvedTab[];
  onClose: () => void;
  title: string;
}

const Section = memo<SectionProps>(({ title, items, isPinned, onClose }) => {
  const styles = useStyles;

  if (items.length === 0) return null;

  return (
    <>
      <div className={styles.title}>{title}</div>
      {items.map((item) => (
        <PageItem isPinned={isPinned} item={item} key={item.tab.id} onClose={onClose} />
      ))}
    </>
  );
});

Section.displayName = 'Section';

export default Section;

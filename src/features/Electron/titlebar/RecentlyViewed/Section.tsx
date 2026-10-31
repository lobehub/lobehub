'use client';

import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { type ResolvedTab } from '../TabBar/hooks/useResolvedTabs';
import PageItem from './PageItem';
import { styles } from './styles';

interface SectionProps {
  isPinned: boolean;
  items: ResolvedTab[];
  onClose: () => void;
  title: string;
}

const Section = memo<SectionProps>(({ title, items, isPinned, onClose }) => {
  if (items.length === 0) return null;

  return (
    <>
      <div {...stylex.props(styles.title)}>{title}</div>
      {items.map((item) => (
        <PageItem isPinned={isPinned} item={item} key={item.tab.id} onClose={onClose} />
      ))}
    </>
  );
});

Section.displayName = 'Section';

export default Section;

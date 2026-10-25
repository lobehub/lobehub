import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import { useEntityDataContext } from '../context';
import { type MemoryEntity } from '../types';
import Header from './Header';
import NowSection from './NowSection';
import Related from './Related';
import Timeline from './Timeline';

const styles = stylex.create({
  scroll: { flex: '1', height: '100%', minWidth: 0, overflowY: 'auto' },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '40px',
    marginInline: 'auto',
    maxWidth: '720px',
    paddingBlockEnd: '96px',
    paddingBlockStart: '40px',
    paddingInline: '48px',
  },
});

interface EntityPageProps {
  entity: MemoryEntity;
}

/**
 * One column in decision order: what it is → how it is now → what is next → how it got here →
 * what else it touches.
 */
const EntityPage = memo<EntityPageProps>(({ entity }) => {
  const { links } = useEntityDataContext();
  const entries = links?.activities.get(entity.id) ?? [];

  return (
    // Keyed by page so following a link starts at the top with no half-finished edit.
    <main aria-label={entity.title} key={entity.id} {...stylex.props(styles.scroll)}>
      <div {...stylex.props(styles.column)}>
        <Header entity={entity} />
        <NowSection entity={entity} />
        <Timeline entries={entries} />
        <Related entity={entity} />
      </div>
    </main>
  );
});

EntityPage.displayName = 'EntityPage';

export default EntityPage;

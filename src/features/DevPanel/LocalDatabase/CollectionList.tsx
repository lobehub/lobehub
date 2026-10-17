'use client';

import { cx, Input } from '@lobehub/ui';
import { Boxes, Table2 } from 'lucide-react';
import { useState } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';
import type { LocalDatabaseCollectionInfo } from '@/libs/localDatabase';

import { inspectorStyles as styles } from '../inspectorStyles';
import type { ReplicaResourceGroup } from './model';

interface CollectionListProps {
  collections: LocalDatabaseCollectionInfo[];
  onSelectCollection: (name: string) => void;
  onSelectResource: (resource: string | null) => void;
  resources: ReplicaResourceGroup[];
  selectedCollection: string | null;
  selectedResource: string | null;
}

interface ListItemProps {
  active: boolean;
  count: number;
  icon: typeof Table2;
  indent?: boolean;
  name: string;
  onClick: () => void;
}

const ListItem = ({ active, count, icon: Icon, indent, name, onClick }: ListItemProps) => (
  <button
    aria-pressed={active}
    title={name}
    type={'button'}
    className={cx(
      styles.listItem,
      indent && styles.listItemNested,
      active && styles.listItemActive,
    )}
    onClick={onClick}
  >
    <Icon className={styles.listIcon} size={14} />
    <span className={styles.listName}>{name}</span>
    <span className={styles.listCount}>{count}</span>
  </button>
);

const CollectionList = ({
  collections,
  onSelectCollection,
  onSelectResource,
  resources,
  selectedCollection,
  selectedResource,
}: CollectionListProps) => {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const visibleCollections = term
    ? collections.filter(({ name }) => name.toLowerCase().includes(term))
    : collections;

  return (
    <aside
      aria-label={'Database collections'}
      className={cx(styles.sidePane, devDockPanelStyles.paneDividerEnd)}
    >
      <div className={devDockPanelStyles.paneHeader}>Collections</div>
      <div className={devDockPanelStyles.paneSearch}>
        <Input
          allowClear
          className={devDockPanelStyles.searchInput}
          placeholder={'Search collections…'}
          size={'small'}
          value={search}
          variant={'borderless'}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className={styles.list}>
        {visibleCollections.length === 0 ? (
          <div className={styles.empty}>{search ? 'No collections match.' : 'No collections.'}</div>
        ) : (
          visibleCollections.map(({ entryCount, name }) => {
            const active = name === selectedCollection;

            return (
              <div key={name}>
                <ListItem
                  active={active && !selectedResource}
                  count={entryCount}
                  icon={Table2}
                  name={name}
                  onClick={() => (active ? onSelectResource(null) : onSelectCollection(name))}
                />
                {active &&
                  resources.map((resource) => (
                    <ListItem
                      indent
                      active={resource.name === selectedResource}
                      count={resource.entryCount}
                      icon={Boxes}
                      key={resource.name}
                      name={resource.name}
                      onClick={() => onSelectResource(resource.name)}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};

export default CollectionList;

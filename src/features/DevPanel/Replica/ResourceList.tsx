'use client';

import { cx, Input } from '@lobehub/ui';
import { Boxes } from 'lucide-react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import { inspectorStyles as styles } from '../inspectorStyles';
import type { ReplicaResourceSummary } from './model';
import { replicaStyles } from './styles';

interface ResourceListProps {
  onSearchChange: (value: string) => void;
  onSelect: (namespace: string) => void;
  resources: ReplicaResourceSummary[];
  search: string;
  selectedNamespace: string | undefined;
}

const ResourceList = ({
  onSearchChange,
  onSelect,
  resources,
  search,
  selectedNamespace,
}: ResourceListProps) => (
  <aside
    aria-label={'Replica resources'}
    className={cx(styles.sidePane, devDockPanelStyles.paneDividerEnd)}
  >
    <div className={devDockPanelStyles.paneHeader}>Resources</div>
    <div className={devDockPanelStyles.paneSearch}>
      <Input
        allowClear
        className={devDockPanelStyles.searchInput}
        placeholder={'Search resources…'}
        size={'small'}
        value={search}
        variant={'borderless'}
        onChange={(event) => onSearchChange(event.target.value)}
      />
    </div>
    <div className={styles.list}>
      {resources.length === 0 ? (
        <div className={styles.empty}>
          {search ? 'No resources match.' : 'No replica has been created yet.'}
        </div>
      ) : (
        resources.map(
          ({ entryCount, name, namespace, paged, pendingCount, persisted, version }) => {
            const active = namespace === selectedNamespace;

            return (
              <button
                aria-pressed={active}
                className={cx(styles.listItem, active && styles.listItemActive)}
                key={namespace}
                title={`${namespace}${persisted ? '' : ' · memory only'}${paged ? ' · paged' : ''}`}
                type={'button'}
                onClick={() => onSelect(namespace)}
              >
                <Boxes className={styles.listIcon} size={14} />
                <span className={styles.listName}>{name}</span>
                <span className={replicaStyles.resourceMeta}>
                  {pendingCount > 0 && (
                    <span className={cx(replicaStyles.badge, replicaStyles.badgePending)}>
                      {pendingCount}↺
                    </span>
                  )}
                  <span className={replicaStyles.badge}>v{version}</span>
                  <span className={styles.listCount}>{entryCount}</span>
                </span>
              </button>
            );
          },
        )
      )}
    </div>
  </aside>
);

export default ResourceList;

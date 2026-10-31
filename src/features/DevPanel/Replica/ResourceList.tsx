'use client';

import { Input } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
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
    {...stylex.props(styles.sidePane, devDockPanelStyles.paneDividerEnd)}
  >
    <div {...stylex.props(devDockPanelStyles.paneHeader)}>Resources</div>
    <div {...stylex.props(devDockPanelStyles.paneSearch)}>
      <Input
        allowClear
        className={stylex.props(devDockPanelStyles.searchInput).className}
        placeholder={'Search resources…'}
        size={'small'}
        value={search}
        variant={'borderless'}
        onChange={(event) => onSearchChange(event.target.value)}
      />
    </div>
    <div {...stylex.props(styles.list)}>
      {resources.length === 0 ? (
        <div {...stylex.props(styles.empty)}>
          {search ? 'No resources match.' : 'No replica has been created yet.'}
        </div>
      ) : (
        resources.map(
          ({ entryCount, name, namespace, paged, pendingCount, persisted, version }) => {
            const active = namespace === selectedNamespace;

            return (
              <button
                aria-pressed={active}
                {...stylex.props(styles.listItem, active && styles.listItemActive)}
                key={namespace}
                title={`${namespace}${persisted ? '' : ' · memory only'}${paged ? ' · paged' : ''}`}
                type={'button'}
                onClick={() => onSelect(namespace)}
              >
                <Boxes className={stylex.props(styles.listIcon).className} size={14} />
                <span {...stylex.props(styles.listName)}>{name}</span>
                <span {...stylex.props(replicaStyles.resourceMeta)}>
                  {pendingCount > 0 && (
                    <span {...stylex.props(replicaStyles.badge, replicaStyles.badgePending)}>
                      {pendingCount}↺
                    </span>
                  )}
                  <span {...stylex.props(replicaStyles.badge)}>v{version}</span>
                  <span {...stylex.props(styles.listCount)}>{entryCount}</span>
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

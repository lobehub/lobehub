import { BRANDING_NAME } from '@lobechat/business-const';
import { cx, Flexbox, Icon } from '@lobehub/ui';
import { Input, showContextMenu, Skeleton, toast, Tree, type TreeDataNode } from '@lobehub/ui';
import {
  AppWindowIcon,
  BoxIcon,
  ChevronDownIcon,
  CpuIcon,
  GpuIcon,
  type LucideIcon,
  MessageSquareIcon,
  SearchIcon,
  SquareTerminalIcon,
} from 'lucide-react';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppProcessMetrics } from '@/features/DevDock/widgets/appProcessMetrics';

import { topicName, TopicTitle } from '../ActivityTable';
import { formatCpu, formatMemory, stopActivity, useActivities } from '../state';
import StopButton from '../StopButton';
import {
  buildProcessTree,
  type RowModel,
  SECTION_APP,
  SECTION_BACKGROUND,
  type SortKey,
} from './buildTree';
import { styles } from './style';

const APP_ICONS: Record<string, LucideIcon> = {
  Browser: CpuIcon,
  GPU: GpuIcon,
  Tab: AppWindowIcon,
  Utility: BoxIcon,
};

const rowIcon = (row: RowModel): LucideIcon | undefined => {
  if (row.kind === 'app') return APP_ICONS[row.appType ?? ''] ?? BoxIcon;
  if (row.kind === 'activity') return SquareTerminalIcon;
  if (row.kind === 'conversation') return row.topicId ? MessageSquareIcon : CpuIcon;
};

function Cells({ row }: { row: RowModel }) {
  const icon = rowIcon(row);
  const hot = row.cpuHot || row.memoryHot;
  return (
    <span className={cx(styles.cells, row.kind === 'section' && styles.section)}>
      <span className={styles.name}>
        {icon && <Icon className={styles.kind} icon={icon} size={14} />}
        {hot && <i className={styles.dot} />}
        <span className={styles.label} title={row.label}>
          {row.kind === 'conversation' && row.topicId ? <TopicTitle id={row.topicId} /> : row.label}
        </span>
        {row.sub && <span className={styles.sub}>{row.sub}</span>}
      </span>
      <span className={cx(styles.num, row.cpuHot && styles.hot)}>{formatCpu(row.cpu)}</span>
      <span className={cx(styles.num, row.memoryHot && styles.hot)}>
        {formatMemory(row.memory)}
      </span>
      <span className={styles.pid}>{row.pid}</span>
      {row.stopId ? (
        <span data-stop-cell className={styles.stop}>
          <StopButton rootId={row.stopId} />
        </span>
      ) : (
        <span />
      )}
    </span>
  );
}

const collectExpandable = (nodes: TreeDataNode[], out: string[] = []) => {
  for (const node of nodes)
    if (node.children?.length) {
      out.push(node.key);
      collectExpandable(node.children, out);
    }
  return out;
};

const openByDefault = (key: string) =>
  key === SECTION_APP || key === SECTION_BACKGROUND || key.startsWith('conversation:');

export default function ProcessExplorer() {
  const { t } = useTranslation('chat');
  const metrics = useAppProcessMetrics();
  const { activities, sampledAt, selected: selectedActivity, totalMemoryMB } = useActivities();
  const [sort, setSort] = useState<SortKey>('cpu');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(
    () => selectedActivity && `activity:${selectedActivity}`,
  );
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());

  const { rows, treeData } = useMemo(
    () =>
      buildProcessTree({
        activities,
        appProcesses: metrics?.processes ?? null,
        labels: {
          app: BRANDING_NAME,
          background: t('backgroundActivity.title'),
          conversation: t('backgroundActivity.topic'),
          gpu: t('processExplorer.gpu'),
          main: t('processExplorer.main'),
          processCount: (count) => t('backgroundActivity.processCount', { count }),
          shared: t('backgroundActivity.shared'),
          utility: t('processExplorer.utility'),
          window: t('processExplorer.window'),
        },
        query,
        sort,
        topicTitle: topicName,
        totalMemoryMB,
      }),
    [activities, metrics, query, sort, t, totalMemoryMB],
  );

  const expandedKeys = collectExpandable(treeData).filter(
    (key) => !!query || openByDefault(key) !== toggled.has(key),
  );
  const background = rows.get(SECTION_BACKGROUND)!;
  const app = rows.get(SECTION_APP)!;
  const processCount =
    (metrics?.processes.length ?? 0) +
    activities.reduce((total, row) => total + row.processes.length, 0);

  const stop = (id: string) =>
    stopActivity(id).catch((error) => {
      console.error(error);
      toast.error(t('backgroundActivity.stopFailed'));
    });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    const stopId = selected && rows.get(selected)?.stopId;
    if (!stopId || (event.target as HTMLElement).closest('input')) return;
    event.preventDefault();
    void stop(stopId);
  };

  const sortHeader = (key: SortKey, label: string) => (
    <button
      className={cx(styles.sort, sort === key && styles.sortActive)}
      type={'button'}
      onClick={() => setSort(key)}
    >
      {label}
      {sort === key && <Icon icon={ChevronDownIcon} size={12} />}
    </button>
  );

  return (
    <Flexbox flex={1} style={{ minHeight: 0 }}>
      <Flexbox horizontal align={'center'} className={styles.toolbar} gap={20}>
        <span className={styles.stat}>
          {t('backgroundActivity.cpu')}
          <b>{formatCpu((background.cpu ?? 0) + (app.cpu ?? 0))}</b>
        </span>
        <span className={styles.stat}>
          {t('backgroundActivity.memory')}
          <b>{formatMemory(background.memory + app.memory)}</b>
          {totalMemoryMB > 0 && `/ ${formatMemory(totalMemoryMB)}`}
        </span>
        <span className={styles.stat}>
          {t('processExplorer.processes')}
          <b>{processCount}</b>
        </span>
        <Flexbox flex={1} />
        <Input
          placeholder={t('processExplorer.filter')}
          prefix={<Icon icon={SearchIcon} size={14} />}
          size={'small'}
          style={{ width: 200 }}
          type={'search'}
          value={query}
          variant={'filled'}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Flexbox>
      <div className={styles.body} onKeyDown={onKeyDown}>
        <div className={cx(styles.cells, styles.header)}>
          <span>{t('processExplorer.name')}</span>
          {sortHeader('cpu', t('backgroundActivity.cpu'))}
          {sortHeader('memory', t('backgroundActivity.memory'))}
          <span className={styles.headerPid}>{t('processExplorer.pid')}</span>
          <span />
        </div>
        {metrics || activities.length > 0 ? (
          <Tree
            blockNode
            showLine
            classNames={{ node: styles.node, title: styles.title }}
            expandedKeys={expandedKeys}
            selectedKeys={selected ? [selected] : []}
            styles={{ node: { height: 28 } }}
            titleRender={(node) => <Cells row={rows.get(node.key)!} />}
            treeData={treeData}
            onSelect={(keys) => setSelected(keys[0])}
            onExpand={(_, { node }) =>
              setToggled((prev) => {
                const next = new Set(prev);
                if (!next.delete(node.key)) next.add(node.key);
                return next;
              })
            }
            onRightClick={({ event, node }) => {
              const row = rows.get(node.key);
              if (!row || row.kind === 'section') return;
              event.preventDefault();
              setSelected(node.key);
              showContextMenu([
                {
                  danger: true,
                  disabled: !row.stopId,
                  key: 'stop',
                  label: t('backgroundActivity.stop'),
                  onClick: () => row.stopId && void stop(row.stopId),
                },
                {
                  disabled: !row.pid,
                  key: 'copy-pid',
                  label: t('processExplorer.copyPid'),
                  onClick: () => void navigator.clipboard.writeText(String(row.pid)),
                },
              ]);
            }}
          />
        ) : (
          <Flexbox padding={16}>
            <Skeleton.Text rows={4} />
          </Flexbox>
        )}
      </div>
      <Flexbox horizontal align={'center'} className={styles.status} justify={'space-between'}>
        <span className={styles.live}>
          <i />
          {t('processExplorer.live')}
        </span>
        {sampledAt > 0 && (
          <span>
            {t('processExplorer.updated', { time: new Date(sampledAt).toLocaleTimeString() })}
          </span>
        )}
      </Flexbox>
    </Flexbox>
  );
}

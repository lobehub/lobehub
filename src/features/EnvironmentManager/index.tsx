'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import { Center, Empty, Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ContainerIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { memo, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import ListSkeleton from '@/components/ListSkeleton';

import { openCreateEnvironmentModal } from './CreateEnvironmentModal';
import { openCreateInstanceModal } from './CreateInstanceModal';
import EnvironmentDetailPanel from './EnvironmentDetailPanel';
import EnvironmentItem from './EnvironmentItem';
import { useEnvironments, useInstances, useWorkspaceUsage } from './useEnvironmentData';
import WorkspaceUsageMeter from './WorkspaceUsageMeter';

const styles = createStaticStyles(({ css }) => ({
  detailCol: css`
    align-self: stretch;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  /**
   * One frame around the list, on the page's own surface. A settings group
   * would nest a card inside a card and inset every row by its own padding,
   * which left each row's hover and selection background floating in a gutter
   * instead of filling the panel.
   */
  listCol: css`
    overflow: hidden;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  listScroll: css`
    overflow-y: auto;

    /* Cap the list so a long shelf of environments stays scrollable rather than
       pushing the page down past the panel sitting beside it. */
    max-height: 480px;
  `,
}));

/** What the list occupies before it knows its length — the skeleton's own rows. */
const LIST_MIN_HEIGHT = 4 * 72;

/**
 * Environments and the instances built from them.
 *
 * An environment is a SPECIFICATION — the sources to check out, what makes them
 * usable, what they run with. What a sandbox builds from it is a cache, which is
 * why a copy can be thrown away and made again rather than repaired by hand.
 *
 * List beside detail, the shape the device manager uses: the rows carry only
 * what tells one environment from another, and picking one opens everything
 * else about it next to the list rather than in place of it.
 */
interface EnvironmentManagerProps {
  /**
   * Put beside the actions rather than above them, so the page has one header
   * row instead of two. Passed in rather than built here because only a page
   * with more than one pool has anything to put in it, and that page is the one
   * that owns which pool is selected.
   */
  tabs?: ReactNode;
  /**
   * Workspace pages only: which pool to manage — `public` (published to the
   * workspace) or `private` (the caller's own). Omitted on the personal page,
   * where an environment has no pool to belong to.
   */
  visibility?: EnvironmentVisibility;
}

const EnvironmentManager = memo<EnvironmentManagerProps>(({ tabs, visibility }) => {
  const { t } = useTranslation('setting');
  const { data, error, isValidating, mutate } = useEnvironments(visibility);
  const { data: instanceData, mutate: refreshInstances } = useInstances();
  const { refresh: refreshUsage } = useWorkspaceUsage();

  const [selectedId, setSelectedId] = useState<string>();
  // Whether a refresh the user asked for is still running.
  const [refreshing, setRefreshing] = useState(false);
  /**
   * Whether the first fetch of THIS mount has come back.
   *
   * A pool visited earlier is still in SWR's cache, so switching back to it
   * rendered last time's answer instantly and revalidated behind the scenes —
   * no skeleton, no sign anything was happening, and a list that may already
   * have been wrong. Switching tabs is the question being asked again, so it
   * waits for the new answer. Only the first fetch after a mount gates; later
   * background revalidations must not throw away a list the reader is using.
   */
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isValidating) setReady(true);
  }, [isValidating]);

  const environments = data?.environments ?? [];
  const instances = instanceData?.instances ?? [];
  const selected = selectedId
    ? environments.find((environment) => environment.id === selectedId)
    : undefined;

  const select = (id: string) => {
    setSelectedId((current) => (current === id ? undefined : id));
  };

  // The row's shortcut: open the environment so the new instance is seen
  // landing in its list, and ask for the instance in the same dialog the
  // panel's own button opens.
  const createInstance = (id: string) => {
    setSelectedId(id);
    openCreateInstanceModal({ environmentId: id });
  };

  /**
   * Both lists, because the two halves of what this page shows are fetched
   * separately and the slow one — instance state, which needs the execution
   * plane — is the one worth a manual refresh.
   *
   * The spinner is driven by this call rather than by SWR's `isValidating`,
   * which is true of every fetch the page makes. Read off that flag the button
   * span on a tab switch and on any background revalidation, reporting work
   * nobody asked it to do and, worse, implying the click had already happened.
   */
  const refresh = async () => {
    setRefreshing(true);
    try {
      // The storage figure rides along, because this is the one moment the
      // user has asked for a fresh answer — and re-measuring also stamps the
      // workspace as active, which no page load should do on its own.
      await Promise.all([mutate(), refreshInstances(), refreshUsage()]);
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * The storage meter, the way to add one, and the way to refetch. Shared by
   * both layouts because they are the same things wherever they sit; only the
   * frame around them differs.
   *
   * No count of environments: the list is right below it and short enough to
   * take in at a glance, so the number restated what the reader could already
   * see. The meter stays because it is the one number the page cannot show —
   * and the one that stops it working when it runs out.
   */
  const actions = (
    // `flex: none`, because this shares a `space-between` row with whatever
    // names the list. Left shrinkable, the group gets compressed by a wide
    // neighbour.
    <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
      <WorkspaceUsageMeter />
      <Button
        icon={<Icon icon={RefreshCwIcon} />}
        loading={refreshing}
        title={t('environments.refresh')}
        onClick={refresh}
      />
      <Button
        icon={<Icon icon={PlusIcon} />}
        type={'primary'}
        onClick={() => openCreateEnvironmentModal(visibility)}
      >
        {t('environments.create')}
      </Button>
    </Flexbox>
  );

  const list = (
    <AsyncBoundary
      // Both gated on the same signal, because the boundary reads `data` as
      // "has anything settled": handing it the cache while saying the fetch is
      // still running would show that cache, which is the thing being avoided.
      data={ready ? data : undefined}
      error={error}
      errorVariant={'block'}
      isEmpty={environments.length === 0}
      isLoading={!ready}
      empty={
        // Inside the same frame the rows land in, sized to the skeleton's
        // rows: loading, empty and loaded are one surface whose contents
        // change, not three surfaces of three different heights.
        <Flexbox className={styles.listCol}>
          <Center style={{ minHeight: LIST_MIN_HEIGHT }} width={'100%'}>
            <Empty
              description={t('environments.desc')}
              descriptionProps={{ fontSize: 13 }}
              icon={ContainerIcon}
              style={{ maxWidth: 360 }}
              action={
                <Button
                  icon={<Icon icon={PlusIcon} />}
                  onClick={() => openCreateEnvironmentModal(visibility)}
                >
                  {t('environments.create')}
                </Button>
              }
              title={t(
                visibility === 'public' ? 'environments.emptyPublished' : 'environments.empty',
              )}
            />
          </Center>
        </Flexbox>
      }
      loading={
        <Flexbox className={styles.listCol}>
          <Flexbox padding={4}>
            <ListSkeleton />
          </Flexbox>
        </Flexbox>
      }
      onRetry={refresh}
    >
      <Flexbox horizontal align={'flex-start'} gap={16}>
        <Flexbox className={styles.listCol} flex={1}>
          <Flexbox className={styles.listScroll} gap={2} padding={4}>
            {environments.map((environment) => (
              <EnvironmentItem
                environment={environment}
                key={environment.id}
                selected={environment.id === selectedId}
                instanceCount={
                  instances.filter((instance) => instance.environmentId === environment.id).length
                }
                // What the environment's instances keep, summed. A brand-new
                // instance has no snapshot and counts as nothing; when the
                // snapshot store could not be reached the sizes are unknown,
                // not zero, so the row says nothing rather than "0 B".
                storageBytes={
                  instanceData?.snapshotsUnavailable
                    ? null
                    : instances
                        .filter((instance) => instance.environmentId === environment.id)
                        .reduce((sum, instance) => sum + (instance.snapshot?.bytes ?? 0), 0)
                }
                onCreateInstance={() => createInstance(environment.id)}
                onSelect={() => select(environment.id)}
              />
            ))}
          </Flexbox>
        </Flexbox>
        {/* Twice the list's share. A row carries a name and two facts; the panel
            carries a form, so an even split starved the half doing the work and
            left the other half mostly empty. */}
        {selected && (
          <Flexbox className={styles.detailCol} flex={2}>
            {/* Keyed on the environment so the form's draft state resets when
                  the selection changes — a description typed for one
                  environment must not survive into another. */}
            <EnvironmentDetailPanel
              environment={selected}
              key={selected.id}
              onClose={() => setSelectedId(undefined)}
            />
          </Flexbox>
        )}
      </Flexbox>
    </AsyncBoundary>
  );

  /**
   * One layout for both pages. What sits on the left of the header is the only
   * difference: tabs where there is a pool to choose, and the section's own
   * name where there is not.
   */
  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        {tabs ?? (
          <Text fontSize={16} weight={600}>
            {t('environments.mine')}
          </Text>
        )}
        {actions}
      </Flexbox>
      {list}
    </Flexbox>
  );
});

EnvironmentManager.displayName = 'EnvironmentManager';

export default EnvironmentManager;

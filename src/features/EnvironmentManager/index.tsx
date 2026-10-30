'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import {
  Button,
  Center,
  createStaticStyles,
  cssVar,
  Empty,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import { ContainerIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { memo, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import ListSkeleton from '@/components/ListSkeleton';

import { openCreateEnvironmentModal } from './CreateEnvironmentModal';
import EnvironmentDetailPanel from './EnvironmentDetailPanel';
import EnvironmentItem from './EnvironmentItem';
import { type CreatedEnvironment, useEnvironments } from './useEnvironmentData';

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
 * Code environments and the folders initialized from them.
 *
 * An environment is a SPECIFICATION — the sources to check out, what makes them
 * usable, what they run with. Writing one down needs no drive, so this page is
 * there for everyone; what a sandbox builds from it on the drive is a cache,
 * which is why a folder can be thrown away and made again rather than repaired
 * by hand. Folders are initialized from the directory picker's "new folder";
 * this page lists them, rebuilds, stops and deletes them.
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
  const selected = selectedId
    ? environments.find((environment) => environment.id === selectedId)
    : undefined;

  const select = (id: string) => {
    setSelectedId((current) => (current === id ? undefined : id));
  };

  // Open what was just made. Nothing is built: an environment is applied to
  // a working directory when a conversation picks it.
  const onEnvironmentCreated = (created: CreatedEnvironment) => setSelectedId(created.id);

  /**
   * The spinner is driven by this call rather than by SWR's `isValidating`,
   * which is true of every fetch the page makes — read off that flag the button
   * would spin on a tab switch and on any background revalidation.
   */
  const refresh = async () => {
    setRefreshing(true);
    try {
      await mutate();
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * The way to add one, and the way to refetch. Shared by both layouts because
   * they are the same things wherever they sit; only the frame around them
   * differs. How much of the drive is used is the plan's business, and is
   * shown with the plan's other usage rather than here.
   */
  const actions = (
    // `flex: none`, because this shares a `space-between` row with whatever
    // names the list. Left shrinkable, the group gets compressed by a wide
    // neighbour.
    <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
      <Button
        icon={<Icon icon={RefreshCwIcon} />}
        loading={refreshing}
        title={t('environments.refresh')}
        onClick={refresh}
      />
      <Button
        icon={<Icon icon={PlusIcon} />}
        type={'primary'}
        onClick={() => openCreateEnvironmentModal(visibility, onEnvironmentCreated)}
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
                  onClick={() => openCreateEnvironmentModal(visibility, onEnvironmentCreated)}
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
      <Flexbox horizontal align={'flex-start'} gap={16} wrap={'wrap'}>
        <Flexbox className={styles.listCol} flex={'1 1 320px'}>
          <Flexbox className={styles.listScroll} gap={2} padding={4}>
            {environments.map((environment) => (
              <EnvironmentItem
                environment={environment}
                key={environment.id}
                selected={environment.id === selectedId}
                onSelect={() => select(environment.id)}
              />
            ))}
          </Flexbox>
        </Flexbox>
        {/* Keep enough space to identify environments and read their details.
            When both columns no longer fit, wrap the detail below the list. */}
        {selected && (
          <Flexbox className={styles.detailCol} flex={'2 1 480px'}>
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
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
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

'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import {
  ActionIcon,
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
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import VisibilityFilter, {
  matchesVisibilityFilter,
  type VisibilityFilterValue,
} from '@/components/VisibilityFilter';

import { openCreateEnvironmentModal } from './CreateEnvironmentModal';
import EnvironmentItem from './EnvironmentItem';
import { EnvironmentListSkeleton } from './Skeleton';
import { type CreatedEnvironment, useEnvironments } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
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
 * A list; picking a row opens the environment's own page
 * (`environments/:id`), the shape the device manager uses. The rows carry only
 * what tells one environment from another; everything else about one is on
 * its page, laid out the same way a project's environment page is.
 */
interface EnvironmentManagerProps {
  /**
   * Workspace pages only: where a new environment lands. The list itself is
   * every environment the caller can see — published and their own private
   * ones together. Omitted on the personal page, where an environment has no
   * pool to belong to.
   */
  createVisibility?: EnvironmentVisibility;
  /**
   * Put beside the actions rather than above them, so the page has one header
   * row instead of two. Omitted, the section's own name sits there.
   */
  headerLeading?: ReactNode;
  /** Open one environment's page. */
  onOpenEnvironment: (id: string) => void;
  /**
   * A filter the host owns, when one header filter narrows several lists at
   * once (environments and credentials share a page). The manager then shows
   * no filter of its own.
   */
  visibilityFilter?: VisibilityFilterValue;
}

const EnvironmentManager = memo<EnvironmentManagerProps>(
  ({ createVisibility, headerLeading, onOpenEnvironment, visibilityFilter: hostFilter }) => {
    const { t } = useTranslation('setting');
    // `settled`: a list to paint — the stored one on a reload, confirmed behind
    // it. A stored empty list waits for the server.
    const { environments, error, revalidate, settled } = useEnvironments();

    // Whether a refresh the user asked for is still running.
    const [refreshing, setRefreshing] = useState(false);

    const list = environments ?? [];
    // Workspace pages only (where a new environment has a pool to land in):
    // narrow the one list to private or published environments.
    const [ownFilter, setVisibilityFilter] = useState<VisibilityFilterValue>('all');
    const visibilityFilter = hostFilter ?? ownFilter;
    const isPrivateEnvironment = (environment: (typeof list)[number]) =>
      !!environment.workspaceId && environment.visibility === 'private';
    const showVisibilityFilter = !hostFilter && !!createVisibility && list.length > 0;
    const visibleList =
      createVisibility || hostFilter
        ? list.filter((e) => matchesVisibilityFilter(isPrivateEnvironment(e), visibilityFilter))
        : list;

    // Open what was just made. Nothing is built: an environment is applied to
    // a working directory when a conversation picks it.
    const onEnvironmentCreated = (created: CreatedEnvironment) => onOpenEnvironment(created.id);

    /**
     * The spinner is driven by this call rather than by `isValidating`, which is
     * true of every fetch the page makes — read off that flag the button would
     * spin on any background revalidation.
     */
    const refresh = async () => {
      setRefreshing(true);
      try {
        await revalidate();
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
        {showVisibilityFilter && (
          <VisibilityFilter value={visibilityFilter} onChange={setVisibilityFilter} />
        )}
        <Button
          icon={<Icon icon={PlusIcon} />}
          type={'primary'}
          onClick={() => openCreateEnvironmentModal(createVisibility, onEnvironmentCreated)}
        >
          {t('environments.create')}
        </Button>
        {/* Last and borderless, as on the subscription accounts page. */}
        <ActionIcon
          loading={refreshing}
          title={t('environments.refresh')}
          onClick={refresh}
          icon={RefreshCwIcon}
          // A row that runs short of width shrinks its children; the icon keeps its square.
          style={{ flex: 'none' }}
        />
      </Flexbox>
    );

    const content = (
      <AsyncBoundary
        // A failed background refresh keeps the list it has: the boundary shows
        // the error only while nothing has settled.
        data={settled ? environments : undefined}
        error={error}
        errorVariant={'block'}
        isEmpty={settled && list.length === 0}
        isLoading={!settled && !error}
        loading={<EnvironmentListSkeleton />}
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
                title={t('environments.empty')}
                action={
                  <Button
                    icon={<Icon icon={PlusIcon} />}
                    onClick={() =>
                      openCreateEnvironmentModal(createVisibility, onEnvironmentCreated)
                    }
                  >
                    {t('environments.create')}
                  </Button>
                }
              />
            </Center>
          </Flexbox>
        }
        onRetry={refresh}
      >
        <Flexbox className={styles.listCol} gap={2} padding={4}>
          {visibleList.length === 0 && (
            <Center style={{ minHeight: LIST_MIN_HEIGHT }} width={'100%'}>
              <Empty description={t('visibilityFilter.empty', { ns: 'common' })} />
            </Center>
          )}
          {visibleList.map((environment) => (
            <EnvironmentItem
              environment={environment}
              key={environment.id}
              onSelect={() => onOpenEnvironment(environment.id)}
            />
          ))}
        </Flexbox>
      </AsyncBoundary>
    );

    /**
     * One layout for both pages. What sits on the left of the header is the only
     * difference: the host's own lead-in where it passes one, and the section's
     * own name where it does not.
     */
    return (
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'} wrap={'wrap'}>
          {headerLeading ?? (
            <Text fontSize={16} weight={600}>
              {t('environments.mine')}
            </Text>
          )}
          {actions}
        </Flexbox>
        {content}
      </Flexbox>
    );
  },
);

EnvironmentManager.displayName = 'EnvironmentManager';

export default EnvironmentManager;

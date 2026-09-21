'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import { Center, Empty, Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ContainerIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { memo, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import ListSkeleton from '@/components/ListSkeleton';

import { openCreateEnvironmentModal } from './CreateEnvironmentModal';
import EnvironmentDetailPanel from './EnvironmentDetailPanel';
import EnvironmentItem from './EnvironmentItem';
import { useEnvironments, useInstances } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  detailCol: css`
    align-self: stretch;

    min-width: 0;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
  `,
  /**
   * One frame around the list, on the page's own surface — the device manager's
   * shape. A filled settings group would have put a second card inside the
   * first and repeated the page's title inside it; the route already says what
   * this page is.
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
  const { data, error, isLoading, isValidating, mutate } = useEnvironments(visibility);
  const {
    data: instanceData,
    isValidating: instancesValidating,
    mutate: refreshInstances,
  } = useInstances();

  const [selectedId, setSelectedId] = useState<string>();
  // Whether the selected environment opens with its instance-create form
  // showing. The row's "new instance" action is a shortcut into the panel, not
  // a second way to make one.
  const [adding, setAdding] = useState(false);

  const environments = data?.environments ?? [];
  const instances = instanceData?.instances ?? [];
  const selected = selectedId
    ? environments.find((environment) => environment.id === selectedId)
    : undefined;

  const select = (id: string) => {
    setSelectedId((current) => (current === id ? undefined : id));
    setAdding(false);
  };

  const createInstance = (id: string) => {
    setSelectedId(id);
    setAdding(true);
  };

  // Both lists, because the two halves of what this page shows are fetched
  // separately and the slow one — instance state, which needs the execution
  // plane — is the one worth a manual refresh.
  const refresh = () => {
    void mutate();
    void refreshInstances();
  };

  return (
    <Flexbox gap={16}>
      {/* Whatever narrows the list on the left, whatever acts on it on the
          right. A page with one pool has no tabs, so the count takes that side
          — it is the one fact about the list that the list itself does not
          state, and it keeps the row from being two buttons against a blank. */}
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        {tabs ?? (
          <Text fontSize={12} type={'secondary'} weight={500}>
            {/* Nothing until there is something to count. An unsettled fetch has
                no count yet, and printing zero would be a claim rather than a
                blank — the element still renders so the actions stay right. */}
            {environments.length > 0 ? t('environments.total', { count: environments.length }) : ''}
          </Text>
        )}
        <Flexbox horizontal align={'center'} gap={8} style={{ flex: 'none' }}>
          <Button
            icon={<Icon icon={RefreshCwIcon} />}
            loading={isValidating || instancesValidating}
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
      </Flexbox>

      <AsyncBoundary
        data={data}
        error={error}
        errorVariant={'block'}
        isEmpty={environments.length === 0}
        isLoading={isLoading}
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
                  onCreateInstance={() => createInstance(environment.id)}
                  onSelect={() => select(environment.id)}
                />
              ))}
            </Flexbox>
          </Flexbox>
          {selected && (
            <Flexbox className={styles.detailCol} flex={1}>
              {/* Keyed on the environment so the form's draft state resets when
                  the selection changes — a description typed for one
                  environment must not survive into another. */}
              <EnvironmentDetailPanel
                adding={adding}
                environment={selected}
                key={selected.id}
                onAddingChange={setAdding}
                onClose={() => setSelectedId(undefined)}
              />
            </Flexbox>
          )}
        </Flexbox>
      </AsyncBoundary>
    </Flexbox>
  );
});

EnvironmentManager.displayName = 'EnvironmentManager';

export default EnvironmentManager;

'use client';

import type { EnvironmentVisibility } from '@lobechat/types';
import { Center, Empty, Flexbox, FormGroup, Icon } from '@lobehub/ui';
import { ActionIcon, Button, Text } from '@lobehub/ui/base-ui';
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
   * Inside a settings group the list drops its own frame: the group is already
   * a card, and a bordered card within it draws two nested rectangles around
   * one list. The device manager makes the same call for the same reason.
   */
  plainCol: css`
    overflow: hidden;
    min-width: 0;
    border-radius: ${cssVar.borderRadiusLG};
  `,
  /** The standalone frame, for the page that has no group to sit in. */
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

  /**
   * The count, the way to add one, and the way to refetch. Shared by both
   * layouts because they are the same three things wherever they sit; only the
   * frame around them differs. The count is dropped at zero — the empty state
   * right below already says there are none.
   */
  const actions = (
    <Flexbox horizontal align={'center'} gap={8}>
      {environments.length > 0 && (
        <Text fontSize={12} type={'secondary'} weight={500}>
          {t('environments.total', { count: environments.length })}
        </Text>
      )}
      <Button
        icon={<Icon icon={PlusIcon} />}
        size={'small'}
        onClick={() => openCreateEnvironmentModal(visibility)}
      >
        {t('environments.create')}
      </Button>
      <ActionIcon
        icon={RefreshCwIcon}
        loading={isValidating || instancesValidating}
        size={'small'}
        title={t('environments.refresh')}
        onClick={refresh}
      />
    </Flexbox>
  );

  // A group brings its own card, so the list only frames itself when it is the
  // outermost thing on the page.
  const frame = tabs ? styles.listCol : styles.plainCol;

  const list = (
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
        <Flexbox className={frame}>
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
        <Flexbox className={frame}>
          <Flexbox padding={tabs ? 4 : 0}>
            <ListSkeleton />
          </Flexbox>
        </Flexbox>
      }
      onRetry={refresh}
    >
      <Flexbox horizontal align={'flex-start'} gap={16}>
        <Flexbox className={frame} flex={1}>
          {/* Padding only inside the standalone frame, to keep the rows off its
              border. In a group the body already insets its contents, and
              adding to it pushed every row visibly away from the card. */}
          <Flexbox className={styles.listScroll} gap={2} padding={tabs ? 4 : 0}>
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
  );

  /**
   * Two frames, one for each page that mounts this.
   *
   * With more than one pool, the tabs are the header and they sit on the row
   * with the actions — the shape the workspace device page draws. With one
   * pool there is nothing to switch, so the section names itself instead, the
   * way the personal device page does: a titled group with the actions in its
   * corner and the list inside it.
   */
  if (tabs)
    return (
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
          {tabs}
          {actions}
        </Flexbox>
        {list}
      </Flexbox>
    );

  return (
    <FormGroup
      collapsible={false}
      extra={actions}
      gap={16}
      title={t('environments.mine')}
      variant={'filled'}
    >
      {list}
    </FormGroup>
  );
});

EnvironmentManager.displayName = 'EnvironmentManager';

export default EnvironmentManager;

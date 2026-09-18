'use client';

import { Center, Empty, Flexbox, FormGroup, Icon } from '@lobehub/ui';
import { ActionIcon, Button, Skeleton, Text } from '@lobehub/ui/base-ui';
import { ChevronRightIcon, ContainerIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openCreateEnvironmentModal } from './CreateEnvironmentModal';
import EnvironmentForm from './EnvironmentForm';
import InstanceList from './InstanceList';
import {
  type SandboxEnvironment,
  useEnvironmentActions,
  useEnvironments,
  useInstances,
} from './useEnvironmentData';

interface EnvironmentRowProps {
  environment: SandboxEnvironment;
}

const EnvironmentRow = memo<EnvironmentRowProps>(({ environment }) => {
  const { t } = useTranslation('setting');
  const [open, setOpen] = useState(false);
  const { data: instanceData } = useInstances();
  const actions = useEnvironmentActions();

  const instances = (instanceData?.instances ?? []).filter(
    (instance) => instance.environmentId === environment.id,
  );

  return (
    <Flexbox
      gap={8}
      paddingBlock={8}
      style={{ borderBlockEnd: '1px solid var(--color-border-secondary)' }}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        <ActionIcon
          icon={ChevronRightIcon}
          size={'small'}
          style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }}
          onClick={() => setOpen(!open)}
        />
        <Flexbox flex={1} gap={2}>
          <Text fontSize={14} weight={500}>
            {environment.name}
          </Text>
          <Text fontSize={12} type={'secondary'}>
            {/* The count needs its own key: `empty` has no plural form, so
                passing it a count rendered "no instances yet" over an
                environment that had some. */}
            {environment.description ||
              (instances.length === 0
                ? t('environments.instances.empty')
                : t('environments.instances.count', { count: instances.length }))}
          </Text>
        </Flexbox>
        <ActionIcon
          icon={Trash2Icon}
          size={'small'}
          title={t('environments.remove')}
          onClick={() => actions.removeEnvironment(environment.id)}
        />
      </Flexbox>

      {open && (
        <Flexbox gap={20} paddingInline={32}>
          <EnvironmentForm
            environment={environment}
            onSave={({ configuration, description }) =>
              actions.updateEnvironment({ configuration, description, id: environment.id })
            }
          />
          <InstanceList
            instances={instances}
            snapshotsUnavailable={instanceData?.snapshotsUnavailable ?? false}
            onRemove={actions.removeInstance}
            onCreate={({ name, workingDirectory }) =>
              actions.createInstance({ environmentId: environment.id, name, workingDirectory })
            }
          />
        </Flexbox>
      )}
    </Flexbox>
  );
});

EnvironmentRow.displayName = 'SandboxEnvironmentRow';

/** Three skeleton rows' worth — what the list occupies before it knows its length. */
const LIST_MIN_HEIGHT = 3 * 56;

/**
 * The list's own shape while it loads: three rows, each a name over its
 * description, separated the way the real rows are. A placeholder that matches
 * what replaces it means nothing jumps when the data lands — and a slab of the
 * wrong height was more visible than the wait it covered.
 */
const EnvironmentListSkeleton = memo(() => (
  <Flexbox gap={4}>
    {[0, 1, 2].map((row) => (
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        key={row}
        paddingBlock={8}
        paddingInline={28}
        style={{ borderBlockEnd: '1px solid var(--color-border-secondary)' }}
      >
        <Flexbox flex={1} gap={6}>
          <Skeleton.Text rows={1} style={{ width: 140 }} />
          <Skeleton.Text rows={1} style={{ width: 240 }} />
        </Flexbox>
        {/* Where the row's action sits, so the column of icons on the right
            is already there when the real rows land. */}
        <Skeleton.Avatar shape={'square'} size={24} />
      </Flexbox>
    ))}
  </Flexbox>
));

EnvironmentListSkeleton.displayName = 'EnvironmentListSkeleton';

/**
 * Environments and the instances built from them.
 *
 * An environment is a SPECIFICATION — the sources to check out, what makes them
 * usable, what they run with. What a sandbox builds from it is a cache, which is
 * why a copy can be thrown away and made again rather than repaired by hand.
 */
const EnvironmentManager = memo(() => {
  const { t } = useTranslation('setting');
  const { data, isLoading } = useEnvironments();

  const environments = data?.environments ?? [];

  // A `FormGroup` with free content, not a `Form` fed a bare node: the form
  // shell lays out FORM ITEMS, each carrying its own row padding, and gives an
  // unstructured child none — which rendered this list as a sliver. The group
  // is the shape the workspace budget page uses for the same job.
  const title = (
    <Flexbox horizontal align={'baseline'} gap={8}>
      <span>{t('environments.title')}</span>
      {/* The one thing a reader has to know before filling anything in: what
          they write is stored faithfully and not yet acted on. It sits with the
          title rather than as a banner competing with it. */}
      <Text fontSize={12} type={'secondary'}>
        {t('environments.pending')}
      </Text>
    </Flexbox>
  );

  return (
    <FormGroup
      collapsible={false}
      gap={16}
      title={title}
      variant={'filled'}
      extra={
        <Button
          icon={<Icon icon={PlusIcon} />}
          type={'primary'}
          onClick={openCreateEnvironmentModal}
        >
          {t('environments.create')}
        </Button>
      }
    >
      {isLoading ? (
        <EnvironmentListSkeleton />
      ) : environments.length === 0 ? (
        // Sized to the three rows the skeleton drew, so an empty list holds the
        // same ground a loading one did, and the card does not collapse to a
        // strip the moment the answer is "none".
        <Center style={{ minHeight: LIST_MIN_HEIGHT }} width={'100%'}>
          <Empty
            description={t('environments.desc')}
            descriptionProps={{ fontSize: 13 }}
            icon={ContainerIcon}
            style={{ maxWidth: 360 }}
            title={t('environments.empty')}
            action={
              <Button icon={<Icon icon={PlusIcon} />} onClick={openCreateEnvironmentModal}>
                {t('environments.create')}
              </Button>
            }
          />
        </Center>
      ) : (
        <Flexbox gap={4}>
          {environments.map((environment) => (
            <EnvironmentRow environment={environment} key={environment.id} />
          ))}
        </Flexbox>
      )}
    </FormGroup>
  );
});

EnvironmentManager.displayName = 'EnvironmentManager';

export default EnvironmentManager;

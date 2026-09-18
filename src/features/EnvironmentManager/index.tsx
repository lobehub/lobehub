'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Alert, Button, Input, Text } from '@lobehub/ui/base-ui';
import { ChevronRightIcon, InfoIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
    <Flexbox gap={8} paddingBlock={8}>
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
            {environment.description ||
              t('environments.instances.empty', { count: instances.length })}
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

/**
 * Environments and the instances built from them.
 *
 * An environment is a SPECIFICATION — the sources to check out, what makes them
 * usable, what they run with. What a sandbox builds from it is a cache, which is
 * why a copy can be thrown away and made again rather than repaired by hand.
 */
const EnvironmentManager = memo(() => {
  const { t } = useTranslation('setting');
  const { data } = useEnvironments();
  const actions = useEnvironmentActions();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const environments = data?.environments ?? [];

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await actions.createEnvironment({ name: name.trim() });
      setName('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Flexbox gap={16}>
      {/* Said out loud rather than left for someone to discover: the fields
          below are stored faithfully, but nothing builds from them yet. */}
      <Alert
        showIcon
        icon={InfoIcon}
        title={t('environments.pending')}
        type={'info'}
        variant={'soft'}
      />

      <Flexbox horizontal align={'center'} gap={8}>
        <Input
          placeholder={t('environments.namePlaceholder')}
          style={{ flex: 1 }}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void create();
          }}
        />
        <Button
          disabled={!name.trim()}
          icon={<Icon icon={PlusIcon} />}
          loading={creating}
          size={'small'}
          onClick={create}
        >
          {t('environments.create')}
        </Button>
      </Flexbox>

      {environments.length === 0 ? (
        <Text fontSize={12} type={'secondary'}>
          {t('environments.empty')}
        </Text>
      ) : (
        environments.map((environment) => (
          <EnvironmentRow environment={environment} key={environment.id} />
        ))
      )}
    </Flexbox>
  );
});

EnvironmentManager.displayName = 'EnvironmentManager';

export default EnvironmentManager;

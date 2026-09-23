'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import InstanceList from './InstanceList';
import { repositoryPath } from './repository';
import { useEnvironmentActions, useEnvironments, useInstances } from './useEnvironmentData';

interface InstanceSectionProps {
  /** Whether the caller owns the environment; a published one is read-only to everyone else. */
  editable: boolean;
  environmentId: string;
}

/**
 * The instances built from one environment, as a section of its detail panel.
 *
 * Beside the environment rather than in a dialog of their own: an instance
 * belongs to exactly one environment, so the environment's own name and
 * specification are the whole context, and both stay on screen while a copy is
 * made or discarded.
 */
const InstanceSection = memo<InstanceSectionProps>(({ editable, environmentId }) => {
  const { data } = useInstances();
  const { data: environmentData } = useEnvironments();
  const actions = useEnvironmentActions();

  const instances = (data?.instances ?? []).filter(
    (instance) => instance.environmentId === environmentId,
  );

  // Read here rather than on each row: every instance in this section is built
  // from the one environment, so the checkout is the section's fact, not the
  // row's. The rows carry it because they are what a person points at.
  const repository = repositoryPath(
    environmentData?.environments.find((environment) => environment.id === environmentId)
      ?.configuration,
  );

  return (
    <Flexbox>
      <InstanceList
        editable={editable}
        environmentId={environmentId}
        instances={instances}
        repository={repository}
        snapshotsPending={data?.snapshotsPending ?? false}
        snapshotsUnavailable={data?.snapshotsUnavailable ?? false}
        onBuild={actions.rebuildInstance}
        onRemove={actions.removeInstance}
      />
    </Flexbox>
  );
});

InstanceSection.displayName = 'InstanceSection';

export default InstanceSection;

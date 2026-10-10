'use client';

import type { EnvironmentKind } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import InstanceList from './InstanceList';
import { repositoryPath } from './repository';
import { useEnvironmentActions, useEnvironments, useInstances } from './useEnvironmentData';

interface InstanceSectionProps {
  /** Whether the caller owns the environment; a published one is read-only to everyone else. */
  editable: boolean;
  environmentId: string;
  kind: EnvironmentKind;
  /**
   * Shown as the environment itself rather than as a list: the panel's
   * Overview, when the environment has one copy.
   */
  single?: boolean;
}

/**
 * The copies built from one environment, as a section of its detail panel.
 *
 * Beside the environment rather than in a dialog of their own: an instance
 * belongs to exactly one environment, so the environment's own name and
 * specification are the whole context, and both stay on screen while a copy is
 * made or discarded.
 */
const InstanceSection = memo<InstanceSectionProps>(({ editable, environmentId, kind, single }) => {
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
        occupancyUnavailable={data?.occupancyUnavailable ?? false}
        repository={repository}
        // A files environment has nothing to build, so its rows carry no
        // build line and no rebuild — only the folder and what is in it.
        showBuild={kind === 'code'}
        single={single}
        onBuild={actions.rebuildInstance}
        onRemove={actions.removeInstance}
        onStop={actions.stopInstance}
      />
    </Flexbox>
  );
});

InstanceSection.displayName = 'InstanceSection';

export default InstanceSection;

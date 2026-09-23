'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import InstanceList from './InstanceList';
import { useEnvironmentActions, useInstances } from './useEnvironmentData';

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
  const actions = useEnvironmentActions();

  const instances = (data?.instances ?? []).filter(
    (instance) => instance.environmentId === environmentId,
  );

  return (
    <Flexbox>
      <InstanceList
        editable={editable}
        environmentId={environmentId}
        instances={instances}
        snapshotsPending={data?.snapshotsPending ?? false}
        snapshotsUnavailable={data?.snapshotsUnavailable ?? false}
        onRemove={actions.removeInstance}
        onRename={actions.renameInstance}
      />
    </Flexbox>
  );
});

InstanceSection.displayName = 'InstanceSection';

export default InstanceSection;

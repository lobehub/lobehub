'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import InstanceList from './InstanceList';
import { useEnvironmentActions, useInstances } from './useEnvironmentData';

interface InstanceSectionProps {
  adding: boolean;
  environmentId: string;
  onAddingChange: (adding: boolean) => void;
}

/**
 * The instances built from one environment, as a section of its detail panel.
 *
 * Beside the environment rather than in a dialog of their own: an instance
 * belongs to exactly one environment, so the environment's own name and
 * specification are the whole context, and both stay on screen while a copy is
 * made or discarded.
 */
const InstanceSection = memo<InstanceSectionProps>(({ adding, environmentId, onAddingChange }) => {
  const { data } = useInstances();
  const actions = useEnvironmentActions();

  const instances = (data?.instances ?? []).filter(
    (instance) => instance.environmentId === environmentId,
  );

  return (
    <Flexbox>
      <InstanceList
        adding={adding}
        instances={instances}
        snapshotsUnavailable={data?.snapshotsUnavailable ?? false}
        onAddingChange={onAddingChange}
        onRemove={actions.removeInstance}
        onCreate={({ name, workingDirectory }) =>
          actions.createInstance({ environmentId, name, workingDirectory })
        }
      />
    </Flexbox>
  );
});

InstanceSection.displayName = 'InstanceSection';

export default InstanceSection;

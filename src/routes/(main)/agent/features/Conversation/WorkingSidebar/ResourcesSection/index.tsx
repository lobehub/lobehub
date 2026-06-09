import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import AgentDocumentsGroup from './AgentDocumentsGroup';
import SkillsGroup from './SkillsGroup';

interface ResourcesSectionProps {
  /** Bound remote device id (device mode); skills are then scanned over RPC. */
  deviceId?: string;
}

const ResourcesSection = memo<ResourcesSectionProps>(({ deviceId }) => {
  const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  // Resolve the cwd the same way the runtime bar / WorkingSidebar do
  // (`useEffectiveWorkingDirectory`). The old `topicCwd || agentCwd` pattern
  // missed `workingDirByDevice[deviceId]` / `device.defaultCwd`, so a
  // device-bound agent resolved to `undefined` here and the skills fetch never
  // fired even though `deviceId` was set.
  const workingDirectory = useEffectiveWorkingDirectory(activeAgentId);

  return (
    <Flexbox
      data-testid="workspace-resources"
      flex={1}
      gap={16}
      paddingBlock={8}
      paddingInline={'8px 12px'}
      style={{ minHeight: 0 }}
    >
      {isHetero && workingDirectory && (
        <SkillsGroup deviceId={deviceId} workingDirectory={workingDirectory} />
      )}
      {!isHetero && (
        <AgentDocumentsGroup
          deviceId={deviceId}
          style={{ flex: 1, minHeight: 0 }}
          workingDirectory={workingDirectory}
        />
      )}
    </Flexbox>
  );
});

ResourcesSection.displayName = 'ResourcesSection';

export default ResourcesSection;

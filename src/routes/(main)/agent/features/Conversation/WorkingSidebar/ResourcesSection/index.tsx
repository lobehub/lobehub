import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import AgentDocumentsGroup from './AgentDocumentsGroup';
import SkillsGroup from './SkillsGroup';

interface ResourcesSectionProps {
  /** Bound remote device id (device mode); skills are then scanned over RPC. */
  deviceId?: string;
}

const ResourcesSection = memo<ResourcesSectionProps>(({ deviceId }) => {
  const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const agentWorkingDirectory = useAgentStore((s) =>
    activeAgentId ? agentByIdSelectors.getAgentWorkingDirectoryById(activeAgentId)(s) : undefined,
  );
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const workingDirectory = topicWorkingDirectory || agentWorkingDirectory;

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

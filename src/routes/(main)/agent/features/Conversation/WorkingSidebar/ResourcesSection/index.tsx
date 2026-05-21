import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import AgentDocumentsGroup from './AgentDocumentsGroup';
import SkillsGroup from './SkillsGroup';

const ResourcesSection = memo(() => {
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
      {isHetero && workingDirectory && <SkillsGroup workingDirectory={workingDirectory} />}
      {!isHetero && <AgentDocumentsGroup style={{ flex: 1, minHeight: 0 }} />}
    </Flexbox>
  );
});

ResourcesSection.displayName = 'ResourcesSection';

export default ResourcesSection;

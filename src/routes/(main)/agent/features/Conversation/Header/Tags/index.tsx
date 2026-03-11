import { ModelTag } from '@lobehub/icons';
import { Flexbox, Skeleton } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import PluginTag from '@/features/PluginTag';
import { useAgentEnableSearch } from '@/hooks/useAgentEnableSearch';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import KnowledgeTag from './KnowledgeTag';
import MemberCountTag from './MemberCountTag';
import SearchTags from './SearchTags';

const TitleTags = memo(() => {
  const [model, provider, hasKnowledge, isLoading] = useAgentStore((s) => [
    agentSelectors.currentAgentModel(s),
    agentSelectors.currentAgentModelProvider(s),
    agentSelectors.hasKnowledge(s),
    agentSelectors.isAgentConfigLoading(s),
  ]);

  const plugins = useAgentStore(agentSelectors.displayableAgentPlugins, isEqual);
  const enabledKnowledge = useAgentStore(agentSelectors.currentEnabledKnowledge, isEqual);

  const showPlugin = useModelSupportToolUse(model, provider);
  const isLogin = useUserStore(authSelectors.isLogin);
  const isGroupSession = useSessionStore(sessionSelectors.isCurrentSessionGroupSession);

  const isAgentEnableSearch = useAgentEnableSearch();

  if (isGroupSession) {
    return (
      <Flexbox horizontal align={'center'} gap={12}>
        <MemberCountTag />
      </Flexbox>
    );
  }

  return isLoading && isLogin ? (
    <Skeleton.Button active size={'small'} style={{ height: 20 }} />
  ) : (
    <Flexbox horizontal align={'center'} gap={4}>
      <ModelSwitchPanel>
        <ModelTag model={model} />
      </ModelSwitchPanel>
      {isAgentEnableSearch && <SearchTags />}
      {showPlugin && plugins?.length > 0 && <PluginTag plugins={plugins} />}
      {hasKnowledge && <KnowledgeTag data={enabledKnowledge} />}
    </Flexbox>
  );
});

export default TitleTags;

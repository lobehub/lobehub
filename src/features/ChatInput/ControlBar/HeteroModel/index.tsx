'use client';

import type { ListHeterogeneousAgentModelsParams } from '@lobechat/types';
import { applyTopicModelToHeterogeneousProvider } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import { ModelCatalogSelector } from './ModelCatalogSelector';
import SelectorMenu from './SelectorMenu';
import { resolveSelectorShape } from './selectorView';
import { useHeteroProviderPatch } from './useHeteroProviderPatch';

const HeteroModel = memo(() => {
  const agentId = useAgentId();
  const provider = useAgentStore(
    (s) => agentByIdSelectors.getAgencyConfigById(agentId)(s)?.heterogeneousProvider,
    isEqual,
  );
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  // Model picks are topic-scoped once a topic exists; the remaining dimensions
  // still write the shared heterogeneous-provider config.
  const { canConfigureResource } = useChatInputResourceAccess();
  const enabled = canCreateContent && canConfigureResource;
  const patch = useHeteroProviderPatch({ agentId, enabled, provider });
  const topicModel = useChatStore(topicSelectors.activeTopicModel);
  const effectiveProvider = provider
    ? applyTopicModelToHeterogeneousProvider(provider, topicModel)
    : undefined;

  const shape = resolveSelectorShape(effectiveProvider, enabled);

  if (shape.kind === 'none' || !effectiveProvider) return null;

  if (shape.kind === 'catalog')
    return (
      <ModelCatalogSelector
        agentId={agentId}
        disabled={false}
        model={shape.capability.model.resolve(effectiveProvider)}
        permissionReason={reason}
        type={effectiveProvider.type as ListHeterogeneousAgentModelsParams['type']}
        onSelect={(value) => void patch({ model: value })}
      />
    );

  return (
    <SelectorMenu
      agentId={agentId}
      capability={shape.capability}
      patch={patch}
      permissionReason={reason}
      provider={effectiveProvider}
    />
  );
});

HeteroModel.displayName = 'HeteroModel';

export default HeteroModel;

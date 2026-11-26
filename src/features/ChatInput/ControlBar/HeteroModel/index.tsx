'use client';

import type { ListHeterogeneousAgentModelsParams } from '@lobechat/types';
import { memo } from 'react';

import { usePermission } from '@/hooks/usePermission';

import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import { ModelCatalogSelector } from './ModelCatalogSelector';
import SelectorMenu from './SelectorMenu';
import { resolveSelectorShape } from './selectorView';
import { useEffectiveHeteroProvider } from './useEffectiveHeteroProvider';
import { useHeteroProviderPatch } from './useHeteroProviderPatch';

const HeteroModel = memo(() => {
  const { agentId, effectiveProvider, provider, topicId, topicPin } = useEffectiveHeteroProvider();
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  // Model, effort and speed picks are topic-scoped once a topic exists; mode
  // still writes the shared heterogeneous-provider config.
  const { canConfigureResource } = useChatInputResourceAccess();
  const enabled = canCreateContent && canConfigureResource;
  const patch = useHeteroProviderPatch({ agentId, enabled, provider });
  const topicScoped = !!topicId;

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
      topicPin={topicPin}
      topicScoped={topicScoped}
    />
  );
});

HeteroModel.displayName = 'HeteroModel';

export default HeteroModel;

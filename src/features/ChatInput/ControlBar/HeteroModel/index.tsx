'use client';

import type { ListHeterogeneousAgentModelsParams } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import { ModelCatalogSelector } from './ModelCatalogSelector';
import SelectorMenu from './SelectorMenu';
import { resolveSelectorShape } from './selectorView';
import { useHeteroProviderPatch } from './useHeteroProviderPatch';

interface HeteroModelProps {
  agentId?: string;
  effortOnly?: boolean;
  selectedModel?: string;
}

const HeteroModel = memo<HeteroModelProps>(({ agentId, effortOnly, selectedModel }) => {
  const contextAgentId = useAgentId();
  const resolvedAgentId = agentId ?? contextAgentId;
  const provider = useAgentStore(
    (s) => agentByIdSelectors.getAgencyConfigById(resolvedAgentId)(s)?.heterogeneousProvider,
    isEqual,
  );
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  // Model/effort picks write the shared heterogeneous-provider config. Hide
  // the selector when this caller cannot configure that shared resource.
  const { canConfigureResource } = useChatInputResourceAccess();
  const enabled = canCreateContent && canConfigureResource;
  const patch = useHeteroProviderPatch({ agentId: resolvedAgentId, enabled, provider });

  const shape = resolveSelectorShape(provider, enabled);

  if (shape.kind === 'none' || !provider) return null;

  const capability = effortOnly
    ? shape.capability.effort
      ? { effort: shape.capability.effort }
      : undefined
    : shape.capability;

  if (!capability) return null;

  if (!effortOnly && shape.kind === 'catalog')
    return (
      <ModelCatalogSelector
        agentId={resolvedAgentId}
        disabled={false}
        model={shape.capability.model.resolve(provider)}
        permissionReason={reason}
        type={provider.type as ListHeterogeneousAgentModelsParams['type']}
        onSelect={(value) => void patch({ model: value })}
      />
    );

  return (
    <SelectorMenu
      agentId={resolvedAgentId}
      capability={capability}
      patch={patch}
      permissionReason={reason}
      provider={provider}
      selectedModel={selectedModel}
    />
  );
});

HeteroModel.displayName = 'HeteroModel';

export default HeteroModel;
